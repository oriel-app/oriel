---
title: Page head
status: drifting
group: Layout
order: 72
classes: page, page-title, thread, thread-head, crumb, thread-title-row, thread-title, state-chip, quiet-action, workstream-head, workstream-title-row, workstream-title, workstream-actions, head-action, workstream-origin, workstream-done, tabs, done-tabs, view-tabs, nav-count, overview, overview-top, overview-counts, overview-since, overview-stat, tooltip, icon
summary: The first line of every page: what it is, where it sits, its state, and the one or two things to do with it as a whole. A thread's, a workstream's, a titled page's and the overview's.
---

# Page head

## What it is

The top of a page, on one `--head-row` (2rem) line, `--inset-top` below the window's edge. It names the page and holds what acts on the whole page. There are four kinds:

- **The thread head** (`header.thread-head`): its workstream's name as a link above (`.crumb`), then the thread's title (`h1.thread-title`), its state as a [state chip](/components/badge) (`.state-chip`), and **Mark done** at the row's end.
- **The workstream head** (`header.workstream-head`): the workstream's name as a field you rename in place (`input.workstream-title`), then Mark done (or Reopen) and Delete as icon buttons (`.head-action`), and under it a line saying where it came from (`.workstream-origin`).
- **A page title** (`h1.page-title`): a page that is a place, not a thing: Settings, Done, and the review link's page. Done has its tabs under it.
- **The overview's top strip** (`.overview-top`): no title. The Overview/Browse [tabs](/components/tabs) and the counts strip, "what changed since the user last looked, in four counts" (`Counts` in `packages/web/src/overview-page.tsx`).

Titles that name a thing or a page wear the theme's heading face: `--font-heading` at `--text-xl` and `--title-weight` (a serif at 600 in Graphite, regular in Broadsheet).

## When to use it

- Every page has exactly one head, first in its `<main>`.
- Use the **thread head** for a thread, and for a new thread (title only, until the first message makes its workstream).
- Use the **workstream head** for a workstream: its name is the person's to change, so it's a field.
- Use a **page title** for a page that holds a list or settings, with tabs under it if the page has views (Done and Dropped).
- Use the **top strip** for the window's two views, overview and Browse, where the counts say more than a title would.

## When not to

- Not for a section inside a page. A section has a small-caps `.section-title`, or on the overview an `.overview-head`; see [Overview sections](/components/overview-section).
- Not a second row of actions. A head holds what acts on the whole page: Mark done, Delete. An action on part of it sits with that part (Add from the window beside Items; Approve and apply in the change set).
- Not a primary button. Nothing in a head is the one thing to do next; Mark done is a [quiet action](/components/button) or an icon.
- Not a breadcrumb trail. The crumb is one link, the workstream the thread is in; there's no deeper path.

## Anatomy and variants

### Thread head

```html specimen id=thread-head title="A thread waiting on a review"
<header class="thread-head">
  <a class="crumb" href="/workstreams/checkout-v2">Checkout v2: phone wallets and saved cards</a>
  <div class="thread-title-row">
    <h1 class="thread-title" tabindex="-1">Which stories here still need estimates?</h1>
    <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
    <button type="button" class="quiet-action">Mark done</button>
  </div>
</header>
```

- `.crumb` is the workstream's name, `--text-sm` in `--text-faint`, on its own `--head-row`; hover turns it `--text`.
- `.thread-title-row` wraps: the title, then the chip, then Mark done pushed to the end with `margin-left: auto`.
- The chip shows where the thread stands. Working with something to wait on reads as what it waits on ("Needs review", "Message held", "Agent working"); otherwise its state ("Done", "Handed off").
- The app wraps the head in `main.thread`, the chat column (44rem at most, `--chat`), inside `.thread-layout` beside the [right rail](/components/right-rail). `.thread` is a full-height column, so the specimens here leave it off.

```html specimen id=thread-head-states title="The chip, by what the thread waits on"
<div class="ws-stack">
  <div class="thread-title-row">
    <h1 class="thread-title">Plan gift cards</h1>
    <span class="state-chip" data-state="working" data-waiting="held">Message held</span>
    <button type="button" class="quiet-action">Mark done</button>
  </div>
  <div class="thread-title-row">
    <h1 class="thread-title">Mark the built stories done</h1>
    <span class="state-chip" data-state="working" data-waiting="agent">Agent working</span>
    <button type="button" class="quiet-action">Mark done</button>
  </div>
  <div class="thread-title-row">
    <h1 class="thread-title">What's in here?</h1>
    <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
    <button type="button" class="quiet-action">Mark done</button>
  </div>
  <div class="thread-title-row">
    <h1 class="thread-title">Rename the epic and plan gift cards in it</h1>
    <span class="state-chip" data-state="done">Done</span>
  </div>
</div>
```

A done thread has no Mark done (`ThreadPage` in `packages/web/src/thread-page.tsx`).

```html specimen id=new-thread title="A new thread: no workstream yet, so no crumb"
<header class="thread-head">
  <div class="thread-title-row">
    <h1 class="thread-title">New thread</h1>
  </div>
</header>
```

With no crumb, the title row is the head's first line and takes its `--head-row` (`.thread-head > .thread-title-row:first-child` in `window.css`).

### Workstream head

```html specimen id=workstream-head title="A workstream: rename in place, Mark done and Delete"
<header class="workstream-head">
  <div class="workstream-title-row">
    <input
      class="workstream-title"
      value="Checkout v2: phone wallets and saved cards"
      aria-label="Workstream name"
      maxlength="120"
    />
    <div class="workstream-actions">
      <button
        type="button"
        class="head-action"
        aria-label="Mark done: Checkout v2: phone wallets and saved cards"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Mark done</span>
      <button
        type="button"
        class="head-action"
        data-danger
        aria-label="Delete Checkout v2: phone wallets and saved cards…"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
          />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Delete…</span>
    </div>
  </div>
  <p class="workstream-origin">Copied from a cluster in the epic grouping · 17 items · v3</p>
</header>
```

- The name is an `<input>` with no frame until it's hovered (`--line`) or focused (`--line-strong` on `--surface`). It's `--text-xl` at `--weight-strong` in the body face. Enter or leaving it saves.
- `.head-action` is a `--head-row` square, `--text-muted`, with `--surface-hover` on hover. Delete's hover turns `--danger` (`data-danger`). Each has a [tooltip](/components/tooltip) after it: "Mark done", "Delete…".
- `.workstream-origin` says where it came from, its size and its version: "Copied from a cluster in the epic grouping", "Made by a thread started from nothing", "Made by a question in the window chat", "Picked by hand".

```html specimen id=workstream-done title="A done workstream: Reopen, and when it was marked done"
<header class="workstream-head">
  <div class="workstream-title-row">
    <input class="workstream-title" value="Declined card retry" aria-label="Workstream name" />
    <div class="workstream-actions">
      <button type="button" class="head-action" aria-label="Reopen: Declined card retry">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2" />
          <path d="M3.25 4.25v3.5h3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Reopen</span>
      <button
        type="button"
        class="head-action"
        data-danger
        aria-label="Delete Declined card retry…"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
          />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Delete…</span>
    </div>
  </div>
  <p class="workstream-origin">Picked by hand · 2 items · v5</p>
  <p class="workstream-done">
    <span class="state-chip" data-state="done">Done</span> Marked done
    <time datetime="2026-11-02T09:41:00Z" title="Nov 2, 2026, 09:41">2d ago</time> by the agent
  </p>
</header>
```

The app's page is `main.page.workstream-page`; window.css has no rule for `workstream-page`, so the specimens leave it off.

### Page titles

```html specimen id=page-title title="A page title: Settings"
<main class="page">
  <h1 class="page-title">Settings</h1>
</main>
```

```html specimen id=done-page title="Done, with its two tabs and their counts"
<main class="page">
  <h1 class="page-title">Done</h1>
  <nav class="tabs done-tabs" aria-label="Done or dropped">
    <a href="/done" aria-current="page">Done <span class="nav-count">12</span></a>
    <a href="/done/dropped">Dropped <span class="nav-count">3</span></a>
  </nav>
</main>
```

`.page` is the reading column: 52rem at most, centred, padded `--inset-top` `--space-6`. `.page > .page-title` gets the `--head-row` height so it lines up with the other heads. The Done page is `main.page.done-page` in the app; `done-page` has no rule.

### The overview's top strip

```html specimen id=overview-top title="Overview: the view tabs and the counts strip"
<main class="overview" aria-busy="false">
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a href="/browse?grouping=epic">Browse</a>
    </nav>
    <p class="overview-counts">
      <span class="overview-since">Since you looked Tue, Nov 3:</span>
      <button type="button" class="overview-stat" aria-expanded="false">
        <strong>12</strong> items changed
      </button>
      <span class="overview-stat"><strong>3</strong> workstreams moved</span>
      <button type="button" class="overview-stat" aria-controls="needs-you">
        <strong>2</strong> need you
      </button>
      <span class="overview-stat"><strong>16</strong> not in a workstream</span>
    </p>
  </div>
</main>
```

- Two kinds of count. A `button.overview-stat` opens something: the first shows what changed, by workstream (`aria-expanded`); the third points at the sidebar's Needs you (`aria-controls="needs-you"`). Buttons have a dotted underline and turn `--accent` on hover. A `span.overview-stat` only says.
- A button whose count is 0 is `disabled` and reads like the spans: no underline, no pointer.
- The since-line is "Since you looked {day}:", or "In the last 90 days:" the first time.
- The app also sets `data-section="strip"` on `.overview-counts` (a hook, no CSS).

```html specimen id=overview-top-first title="The first look, with nothing changed and nothing waiting"
<main class="overview" aria-busy="false">
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a href="/browse?grouping=epic">Browse</a>
    </nav>
    <p class="overview-counts">
      <span class="overview-since">In the last 90 days:</span>
      <button type="button" class="overview-stat" aria-expanded="false" disabled>
        <strong>0</strong> items changed
      </button>
      <span class="overview-stat"><strong>0</strong> workstreams moved</span>
      <button type="button" class="overview-stat" aria-controls="needs-you" disabled>
        <strong>0</strong> need you
      </button>
      <span class="overview-stat"><strong>16</strong> not in a workstream</span>
    </p>
  </div>
</main>
```

### Narrow (≤760px)

Under 760px the counts take a row of their own under the tabs: a four-column grid, the since-line across all four, each count's number (`--text-lg`) over its words (`.overview-counts` in `window.css`).

```html specimen id=overview-top-narrow title="At 390: each count over its words" width=390
<main class="overview" aria-busy="false">
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a href="/browse?grouping=epic">Browse</a>
    </nav>
    <p class="overview-counts">
      <span class="overview-since">Since you looked Tue, Nov 3:</span>
      <button type="button" class="overview-stat" aria-expanded="false">
        <strong>12</strong> items changed
      </button>
      <span class="overview-stat"><strong>3</strong> workstreams moved</span>
      <button type="button" class="overview-stat" aria-controls="needs-you">
        <strong>2</strong> need you
      </button>
      <span class="overview-stat"><strong>16</strong> not in a workstream</span>
    </p>
  </div>
</main>
```

```html specimen id=thread-head-narrow title="At 390: a thread head wraps its chip and Mark done" width=390
<header class="thread-head">
  <a class="crumb" href="/workstreams/checkout-v2">Checkout v2: phone wallets and saved cards</a>
  <div class="thread-title-row">
    <h1 class="thread-title">Which stories here still need estimates?</h1>
    <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
    <button type="button" class="quiet-action">Mark done</button>
  </div>
</header>
```

## States

Hover, focus and active are forced here from window.css's own rules.

```html specimen id=state-hover title="Hover" state=hover
<div class="ws-stack">
  <header class="thread-head">
    <a class="crumb ws-hover" href="/workstreams/checkout-v2"
      >Checkout v2: phone wallets and saved cards</a
    >
    <div class="thread-title-row">
      <h1 class="thread-title">Which stories here still need estimates?</h1>
      <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
      <button type="button" class="quiet-action ws-hover">Mark done</button>
    </div>
  </header>
  <div class="workstream-title-row">
    <input
      class="workstream-title ws-hover"
      value="Checkout v2: phone wallets and saved cards"
      aria-label="Workstream name"
    />
    <div class="workstream-actions">
      <button type="button" class="head-action ws-hover" aria-label="Mark done: Checkout v2">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
        </svg>
      </button>
      <button
        type="button"
        class="head-action ws-hover"
        data-danger
        aria-label="Delete Checkout v2…"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
          />
        </svg>
      </button>
    </div>
  </div>
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a class="ws-hover" href="/browse?grouping=epic">Browse</a>
    </nav>
    <p class="overview-counts">
      <button type="button" class="overview-stat ws-hover" aria-expanded="false">
        <strong>12</strong> items changed
      </button>
    </p>
  </div>
</div>
```

```html specimen id=state-focus title="Focus: the name field, and the ring on the rest" state=focus-visible
<div class="ws-stack">
  <div class="workstream-title-row">
    <input
      class="workstream-title ws-focus"
      value="Checkout v2: phone wallets and saved cards"
      aria-label="Workstream name"
    />
    <div class="workstream-actions">
      <button
        type="button"
        class="head-action ws-focus-visible"
        aria-label="Mark done: Checkout v2"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
        </svg>
      </button>
    </div>
  </div>
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a class="ws-focus-visible" href="/browse?grouping=epic">Browse</a>
    </nav>
    <p class="overview-counts">
      <button type="button" class="overview-stat ws-focus-visible" aria-expanded="false">
        <strong>12</strong> items changed
      </button>
    </p>
  </div>
  <header class="thread-head">
    <a class="crumb ws-focus-visible" href="/workstreams/checkout-v2"
      >Checkout v2: phone wallets and saved cards</a
    >
  </header>
</div>
```

```html specimen id=state-disabled title="Disabled: while the workstream ends, and a count of 0" state=disabled
<div class="ws-stack">
  <div class="workstream-title-row">
    <input class="workstream-title" value="Gift cards" aria-label="Workstream name" />
    <div class="workstream-actions">
      <button type="button" class="head-action" aria-label="Mark done: Gift cards" disabled>
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
        </svg>
      </button>
      <button
        type="button"
        class="head-action"
        data-danger
        aria-label="Delete Gift cards…"
        disabled
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
          />
        </svg>
      </button>
    </div>
  </div>
  <p class="overview-counts">
    <button type="button" class="overview-stat" aria-controls="needs-you" disabled>
      <strong>0</strong> need you
    </button>
  </p>
</div>
```

- **Rest**: as above.
- **Hover**: the crumb and a tab turn `--text`; Mark done shows its quiet-action fill; the name field shows a `--line` frame; a head action gets `--surface-hover` (Delete's turns `--danger`); a count button turns `--accent`.
- **Focus visible**: the global ring (`:focus-visible` in `window.css`) on the crumb, tabs, Mark done, head actions and count buttons. The name field draws its own: `:focus` gives it a `--line-strong` frame on `--surface` and turns the outline off (`.workstream-title:focus` in `window.css`), so its focus is a frame, not the ring.
- **Active**: not styled.
- **Disabled**: head actions are disabled at 0.5 while the workstream is being marked done, reopened or deleted (`EndButtons` in `packages/web/src/end-workstream.tsx`). A count of 0 disables its button.
- **Busy**: no head-level busy look. The thread's `main.thread` sets `aria-busy` while the agent runs, and the chip says "Agent working" or "Applying…". The overview sets `aria-busy` on `main.overview` until it loads.
- **Error** and **empty**: not on the head. A thread or workstream that didn't load shows "This thread didn't load." or "This workstream didn't load." in a `.page` with no head (`ThreadPage` in `packages/web/src/thread-page.tsx`). A deleted workstream keeps only its name, as an `h1.page-title` (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`).

## Keyboard and ARIA

- The thread title is the page's `h1` with `tabindex="-1"`, so the app can move focus to it when the thread opens (`ThreadPage` in `packages/web/src/thread-page.tsx`). The page title is an `h1` too.
- The workstream's name is an `<input aria-label="Workstream name">`. Enter blurs it, and blur saves (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`).
- A head action has only an icon, so its `aria-label` names the action and the workstream: "Mark done: Checkout v2: phone wallets and saved cards", "Delete Gift cards…". Its tooltip ("Mark done", "Delete…") follows it and describes it (`aria-describedby`), unless it only repeats the name.
- Mark done in a thread is a plain `<button>`; nothing confirms it, and an Undo follows. Delete asks first; see [Destructive actions](/patterns/destructive-actions).
- The view tabs and Done's tabs are `<nav>` of links with `aria-current="page"`, not a `tablist`: each is a page with its own address. See [Tabs](/components/tabs).
- The changed count sets `aria-expanded`. The needs-you count sets `aria-controls="needs-you"`; pressing it opens the sidebar if it's folded or a drawer, and moves focus to Needs you.

## Content

- **Thread title**: the thread's own title, or "New thread" before it has one.
- **Crumb**: the workstream's name, exactly. Nothing before or after it.
- **State chip**: one of "Agent working", "Message held", "Draft to apply", "Needs review", "Applying…", "Apply stalled", "Your turn" (`waitingNames` in `packages/web/src/parts.tsx`), or "Working", "Done", "Handed off", "Dropped" (`stateNames` in `packages/web/src/chip.ts`).
- **Mark done**, **Reopen**, **Delete…**: the verbs, in sentence case. Delete ends in "…" because it asks.
- **Origin**: how it was made, then "· {N} items · v{N}".
- **Done line**: "Marked done {when}", plus " by the agent", " by an outside tool" and so on when it wasn't the person.
- **Page titles**: one noun: Settings, Done. Tabs say their view and count it: "Done 12", "Dropped 3".
- **Counts**: a number in `<strong>`, then its words, singular or plural: "1 item changed", "12 items changed", "1 needs you", "2 need you".

## Where the app uses it

- Thread head, with its crumb, title row, chip and Mark done: `ThreadPage` in `packages/web/src/thread-page.tsx`. New thread: `NewThreadPage` in `packages/web/src/thread-page.tsx`. CSS: `.thread-head`, `.crumb`, `.thread-title-row` and `.thread-title` in `window.css`; Mark done's place, `.thread-title-row .quiet-action` in `window.css`.
- State chip: `StateChip` in `packages/web/src/parts.tsx`; `.state-chip` in `window.css`.
- Workstream head: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`; head actions `EndButtons` in `packages/web/src/end-workstream.tsx`. CSS: `.workstream-head`, `.workstream-title`, `.workstream-origin`, `.workstream-done`, `.workstream-title-row` and `.head-action` in `window.css`.
- Page titles: Settings, `SettingsPage` in `packages/web/src/settings-page.tsx`; Done and its tabs, `DonePage` in `packages/web/src/other-pages.tsx`. CSS: `.page`, `.page-title`, `.done-tabs` and `.nav-count` in `window.css`.
- Top strip: `OverviewPage` in `packages/web/src/overview-page.tsx`; `ViewTabs` in `packages/web/src/overview-page.tsx` (Browse uses it too); `Counts` in `packages/web/src/overview-page.tsx`. CSS: `.overview`, `.overview-top`, `.overview-counts`, `.overview-stat`, `button.overview-stat:not(:disabled)`, `.view-tabs` and `.tabs` in `window.css`; narrow, `@media (max-width: 760px)` in `window.css`.

## Drift

Status **drifting**. The heads agree on their height and disagree on their type and their actions:

- **The workstream name isn't a heading.** It's an `<input>` in the body face at `--weight-strong` (`.workstream-title` in `window.css`), where the thread title and page titles use `--font-heading` and `--title-weight`. So a workstream's name is sans and every other page's name is serif, and the workstream page has no `h1` at all (only a deleted one does). The overview has none either.
- **Mark done two ways.** A thread's is a word, `.quiet-action`, at the row's end. A workstream's is an icon, `.head-action`, beside Delete. Same action, same weight of decision.
- **The chip's colours.** "Draft to apply" and "Your turn" wait on the person but get the working colour, not the accent that "Needs review", "Message held" and "Apply stalled" get (`.state-chip:is([data-waiting="review"], [data-waiting="held"], [data-waiting="stalled"])` in `window.css`); "Dropped" has no rule and falls back to the to-do colour.
- `.tabs a { text-decoration: none }` sits apart from the rest of `.tabs` (`.tabs a` in `window.css`).
- `workstream-page`, `done-page` and `settings-page` are classes with no CSS.

Until one `PageHead` settles it, **copy the thread head** for anything that is a thing with a state (`h1` in the heading face, chip, a quiet action at the end), and **`h1.page-title`** for a place. If a name must be editable, copy the workstream head as it is, and say in your story that it has no `h1`. Use `.head-action` icons only where a workstream already does. See [the drift report](/drift).
