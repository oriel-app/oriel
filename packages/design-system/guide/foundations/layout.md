---
title: Layout and density
order: 70
summary: The shell (a sidebar beside the page, with the panel or window chat over or beside it), its width tokens, one screen breakpoint at 760px, container queries for the page, and the narrow 390 view.
---

# Layout and density

Oriel is one window: a sidebar, a page, and sometimes a panel. Its layout tokens are shared, never a theme's (decision 0034), so a theme can change how dense a row is but not where things go.

## The shell

`.shell` in `window.css` is a two-column grid: the sidebar, then the page (`.shell-main`).

- **The sidebar** is `--sidebar` wide: 15.5rem, or 3.25rem folded to icons (`.shell[data-folded]`, ⌘\ or Ctrl+\). It's sticky, and scrolls on its own. See [Sidebar](/components/sidebar).
- **The page** (`.shell-main` in `window.css`) takes the rest. It's a size container called `page`, so what's on it lays out by the page's own width, not the screen's.
- **The item panel and the window chat** are `--panel` (30rem) wide, fixed to the right. Below 1100px they float over the page with `--shadow`. At 1100px and up the shell sets `--beside: var(--panel)` and the page's right margin makes room, so the panel sits beside it (`.shell[data-panel]` in `window.css`). See [Item panel](/components/item-panel).

Inside the page:

- `--page` (74rem): the widest Browse and a thread get.
- `--chat` (44rem): a thread's column, where the messages are.
- `--rail` (15rem): a thread's right rail, beside the chat. See [Right rail](/components/right-rail).
- Settings, Done and a workstream's page are `.page`, 52rem, a literal (`.page` in `window.css`). The overview has no max width.

### One top line

`--inset-top` (`--space-3`) and `--head-row` (2rem) put the first line of every column at the same height: the sidebar's head, a thread's rail inside the page and the panel's head. "Every column's first line: how far down it starts, and how tall it is, its contents centred, so the sidebar, the page, the rail and the panel share one top line" (`--inset-top` in `window.css`). A new column's first row should be `min-height: var(--head-row)`, starting `--inset-top` down.

The page column sets its own `--inset-top`: `--frame-room`, the [frame](/components/frame)'s band, the bead's resting height and `--space-4` (`.shell-main` in `window.css`). So every page's first line starts below where [the bead](/components/bead) rests, and a resting bead covers no page head. A page that starts `--inset-top` down gets this for free.

`--slide-panel` (0.375rem) is how far the panel and the chat slide as they arrive. See [Motion](/foundations/motion).

`--bar-height` is 0 on a wide screen, and 2.75rem under 760px, where the bar replaces the sidebar. Sticky things offset by it.

```live
tokens layout
```

`--sidebar`, `--panel` and `--beside` are set on `.shell`, not on `html`, so the table says "set in a rule".

## Breakpoints

There's one screen breakpoint, 760px, and the rest are container queries, so the page reacts to the room it has, whether the screen is small or the panel is open.

- **760px, the screen** (`@media (max-width: 760px)`): the sidebar becomes a drawer behind a bar, the panel goes full screen, the window chat becomes a bottom sheet, Settings' sections become tabs, and the overview's names wrap. The app reads the same query in its script: "Where the sidebar is a drawer; window.css says the same" (`narrow` in `packages/web/src/app.tsx`). The folded sidebar's rules are the other side of it, at `min-width: 761px`.
- **932px, the page** (`@container page`): a thread's rail moves under the chat. This fires on a phone and on a laptop with the panel beside the page.
- **760px, the page** (`@container page`): rows re-grid to two lines, side padding drops to `--space-3`, and less important columns hide.
- **900px, the overview** (`@container overview (min-width: 900px)`): the overview goes to two columns.
- **1100px, the screen**: the panel sits beside the page instead of over it.
- **`hover: none`**: on a touch screen, actions that show on hover (Make a workstream, a row's remove, Browse's pick) are always shown, some dimmed.
- **600px**: only the plan usage meters stack. It's the one query under 760px, and it could be the page container.

Breakpoints are in px and don't follow the Text size. At Large, a 1280 screen is about 1138 rem-pixels wide, so check a new layout at Large too.

Every query in window.css now, with the line its first rule starts on:

```live
breakpoints
```

## The narrow view (390)

At 390px, everything is one column, and a few things move:

- **The bar.** `.bar` is a sticky line with the menu button and the brand. The menu button's name counts what's waiting: "Open the sidebar, 2 threads waiting on you", with the count shown on the button.
- **The drawer.** The sidebar slides in from the left, `min(18rem, 86vw)` wide, over a scrim. Closed, it's `visibility: hidden`, so it's out of the tab order. Opening it moves focus into it. Escape closes it and gives focus back to the menu button.
- **The rails move.** A thread's right rail goes under the chat. The panel is full screen. The window chat is a bottom sheet, 85% of the screen tall at most.
- **Names wrap instead of truncating.** Workstream names and the overview's titles wrap below 760px, in every theme (decision 0034, `.overview-workstream-name` in `window.css`). That's shared behaviour, not a theme option: a name cut to "Checkout v2: phone wal…" is no use on a phone. Browse's cluster and item titles wrap too, under the page container. The sidebar's names (`.nav-name` in `window.css`) still truncate in the drawer.

```html specimen id=narrow-bar title="The narrow screen's bar" width=390
<header class="bar">
  <button type="button" class="bar-menu" aria-controls="sidebar" aria-expanded="false">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
    <span class="visually-hidden">Open the sidebar, 2 threads waiting on you</span>
    <span class="bar-count" aria-hidden="true">2</span>
  </button>
  <a class="brand" href="/"
    ><svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" /></svg
    >Oriel</a
  >
</header>
```

```html specimen id=narrow-wrap title="At 390, an overview name wraps" width=390
<section class="overview-section" data-section="workstreams" aria-label="Workstreams">
  <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">7</span></h2>
  <ul class="overview-rows">
    <li class="overview-row overview-workstream" data-workstream="ws-checkout">
      <a class="overview-title overview-workstream-name" href="/workstreams/ws-checkout"
        >Checkout v2: phone wallets and saved cards</a
      >
      <span
        class="status-bar"
        role="img"
        aria-label="5 done, 4 in progress, 5 to do"
        title="5 done, 4 in progress, 5 to do"
      >
        <span class="segment done" style="flex-grow: 5"></span>
        <span class="segment in-progress" style="flex-grow: 4"></span>
        <span class="segment todo" style="flex-grow: 5"></span>
      </span>
      <span class="overview-moved"><strong>4</strong> moved, 1 done</span>
      <span class="overview-last" title="Latest member update or thread activity">today</span>
      <span class="overview-workstream-detail"
        ><span>15 Jira</span><span>2 waiting on you · 1 working · 3 done</span></span
      >
    </li>
  </ul>
</section>
```

The workshop's **1280 / 390** switch at the top draws every specimen at that width, with Oriel's own media and container queries answering to it. Look at anything you draw at 390, and at 390 with Large text.

## Density

A theme changes density with two tokens, and nothing else (decision 0034):

| Token       | Graphite | Broadsheet | What it sets                                                      |
| ----------- | -------- | ---------- | ----------------------------------------------------------------- |
| `--row`     | 2rem     | 2.25rem    | A list row's least height: Browse's items, a workstream's members |
| `--row-pad` | 0.375rem | 0.5rem     | An overview row's block padding                                   |

Graphite is compact, for scanning 40 workstreams. Broadsheet is roomier. A new list should use both, so it follows the theme. Spacing between parts stays on the space scale, which no theme changes today. See [Space, shape and elevation](/foundations/space).

## Rules

- **Do** lay a page out by its container (`@container page`), so it works beside the panel as well as on a phone.
- **Do** start a new column's first line `--inset-top` down, `--head-row` tall.
- **Do** let names and titles wrap on a narrow screen, never truncate them there.
- **Do** check every new view at 390, and at Large text.
- **Don't** add a screen breakpoint. 760px is the one, and the app's script reads the same.
- **Don't** hide a hover-only action on a touch screen. Show it under `hover: none`.
- **Don't** set a layout width in a theme. Layout tokens are shared.
- **Don't** hard-code a row height. Use `--row`.
