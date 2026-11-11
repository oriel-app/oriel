---
title: Icons
order: 60
summary: A small set of 16px outline icons drawn inline, stroked in the text's colour. Words first; an icon that's the only label needs an aria-label.
---

# Icons

Oriel has few icons, on purpose. A word says more than a picture to someone who reads for a living, and most actions are words (see [Button](/components/button)). Icons mark the things a person meets dozens of times a day: search, the sidebar's fold, New thread, Settings, a chip's kind.

## How an icon is drawn

Every icon is an inline `<svg>` in the component that uses it, with no icon font, sprite or module. Each is one small function, defined beside its user. `SearchIcon`, `Chevron`, `Mark` and `MenuIcon` are exported, the rest are local.

The convention:

- `viewBox="0 0 16 16"`: a 16-unit grid, drawn with strokes only. Shapes sit inside about 2 units of margin.
- `class="icon"`: the size and stroke come from the class, never the markup.
- `aria-hidden="true"`: the name is in the button's `aria-label`, or in a `.visually-hidden` span beside the icon.

### `.icon`

`.icon` in `window.css`: `width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.4`, with round caps and joins. Because it strokes in `currentColor`, an icon takes its button's colour, hover and disabled included. It's 1rem, so it follows the Text size. (The sidebar's fold below is hidden under 760px, as in the app: switch the workshop to 1280 to see it.)

```html specimen id=icon-in-buttons title="An .icon takes its button's colour: the fold's accent, a head action's grey, Delete's danger on hover"
<div class="ws-row">
  <button type="button" class="sidebar-fold" aria-controls="sidebar" aria-expanded="true">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
    <span class="visually-hidden">Hide sidebar</span>
  </button>
  <button type="button" class="head-action" aria-label="Mark done: Gift cards">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
    </svg>
  </button>
  <button type="button" class="head-action ws-hover" data-danger aria-label="Delete Gift cards…">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
      />
    </svg>
  </button>
  <button type="button" class="sync-now" aria-label="Sync workstream now">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5" />
      <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
    </svg>
  </button>
</div>
```

### `.chevron`

`.chevron` in `window.css`: 1rem, stroked in `--text-faint` at 1.75, with no `currentColor`. It points right, and turns 90° to point down when its button says it's open: `[aria-expanded="true"] > .chevron` in `window.css`. The sidebar draws it smaller, at 0.75rem, in its workstream disclosure and folding heads.

```html specimen id=chevron title="A chevron, closed and open"
<div class="ws-stack">
  <section class="cluster">
    <h2 class="cluster-head">
      <button type="button" class="cluster-toggle" aria-expanded="false">
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name"><span class="cluster-label">Gift cards</span></span>
      </button>
    </h2>
  </section>
  <section class="cluster" data-open>
    <h2 class="cluster-head">
      <button type="button" class="cluster-toggle" aria-expanded="true">
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name"
          ><span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
          <span class="key">SYN-1</span></span
        >
      </button>
    </h2>
  </section>
</div>
```

### `.chip-icon`

`.chip-icon` in `window.css`: an icon inside a sentence. It's sized in `em` (0.875em) so it follows the words round it, sits a little below the line (`vertical-align: -0.1em`), and strokes in `--text-muted` at 1.4. A chip's icon says its kind: a speech bubble for a thread, a box with a plus over a minus for a change set, list lines for a workstream. An item takes its connector's icon from a fixed set of four: a ticket (the default), a page, a message or a table's rows (`itemIcons` in `packages/web/src/parts.tsx`, decision 0049). See [Chip](/components/chip).

```html specimen id=chip-icons title="Chip icons in a sentence"
<div class="reply">
  <p>
    <span
      class="chip"
      data-kind="item"
      data-state="in-progress"
      title="SYN-23: Pay with a phone wallet on the website, in progress"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-23"
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
    is in
    <span
      class="chip"
      data-kind="workstream"
      data-state="open"
      title="Workstream: Checkout v2: phone wallets and saved cards, open"
      ><a
        href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0"
        class="chip-link"
        aria-label="Workstream: Checkout v2: phone wallets and saved cards, open"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg
          ><span class="chip-name">Checkout</span></span
        ><span class="chip-name"> v2: phone wallets and saved cards</span
        ><span class="chip-state">Open</span></a
      ></span
    >.
  </p>
</div>
```

### The mark

`.mark` in `window.css` is Oriel's own: a rounded window with its bars, on a 20-unit grid, 1.125rem, stroked in the accent at 1.6. It goes only beside the word Oriel: the sidebar's head, the narrow bar, the review link page and the first run. Never as a button's icon.

```html specimen id=mark title="The mark, beside its name"
<a class="brand" href="/"
  ><svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
    <path d="M2.5 8.5h15M10 8.5v9" /></svg
  >Oriel</a
>
```

## Every icon in the app

Read from Oriel's `.tsx` files now: every inline `<svg>` whose markup is fixed. Four aren't listed because their markup is computed: `ChipIcon` in `packages/web/src/parts.tsx`, `StepIcon` in `packages/web/src/item-panel.tsx`, the item panel's previous and next, `WarningIcon` in `packages/web/src/sidebar.tsx` and the overview's `Spark` in `packages/web/src/overview-page.tsx`.

```live
icons
```

## Closes are a character

The panel's close, the window chat's close, a member's remove and a change set line's remove are the character × (U+00D7) in a button, at `--text-xl`, not an SVG (`.panel-close` in `window.css`). Each has an `aria-label` that says what it closes or removes: "Close the panel", "Close the chat", "Remove SYN-23", "Leave this change out". A screen reader would otherwise say "times".

```html specimen id=close title="× as a close, named by its label"
<header class="panel-head">
  <p class="panel-source">Jira · SYN-23</p>
  <button type="button" class="panel-close" aria-label="Close the panel">×</button>
</header>
```

## When an icon is the name

Most icons are decoration: the button's name is in its words or its `aria-label`, and the icon is `aria-hidden="true"`. Two icons are the only thing that carries their meaning, so they're named images instead:

- `WarningIcon`: `role="img"` with an `aria-label`, such as "A source has a problem" or "Its last sync didn't work" (`Sources` in `packages/web/src/sidebar.tsx`). It's `.icon.warning-mark`, in `--danger` (`.warning-mark` in `window.css`).
- The overview's `Spark`: `role="img"`, with an `aria-label` and a `<title>`, "23 changes in the last 14 days".

```html specimen id=warning title="A warning that is its own name"
<p class="ws-row" style="margin: 0">
  <span>Jira</span>
  <svg
    class="icon warning-mark"
    viewBox="0 0 16 16"
    role="img"
    aria-label="Its last sync didn't work"
  >
    <path d="M8 2.5l6 10.5H2zM8 6.5v3M8 11.25v.25" />
  </svg>
</p>
```

## Drift

- **Four stroke styles.** `.icon` strokes at 1.4 in `currentColor`. `.chevron` at 1.75 in `--text-faint`. `.mark` at 1.6 in the accent, with butt caps (no linecap set). `.chip-icon` at 1.4 in `--text-muted`, sized in em. Copy `.icon` for anything new.
- **The chevron's turn is written three times**: `[aria-expanded="true"] > .chevron` in `window.css`, and again for the sidebar's disclosure (`.nav-disclose[aria-expanded="true"] .chevron` in `window.css`) and folding heads (`.fold-toggle[aria-expanded="true"] .chevron` in `window.css`).
- **Two closes differ.** The panel's close has a tooltip, "Close (Esc)". The window chat's has none. Both are ×.
- **No icon module.** Icons are defined beside their one user, so the same shape could be drawn twice and differ. None is today. A shared `icons.tsx` would be the place once a second user appears. See [Icon button](/components/icon-button) for the proposed `CloseIcon`.

## Rules

- **Do** use a word when one fits. An icon alone is for something met many times a day.
- **Do** draw on the 16-unit grid with strokes, and give the `<svg>` `class="icon"` and `aria-hidden="true"`.
- **Do** give an icon-only button an `aria-label` that says what it does, such as "Close the panel", or a `.visually-hidden` span.
- **Do** give it a tooltip that repeats the name, with its shortcut if it has one: "Hide the sidebar (⌘\)".
- **Do** use `role="img"` and an `aria-label` for an icon that's the only thing saying something, such as a warning.
- **Don't** set `fill`, `stroke` or a size in the markup. The class does.
- **Don't** colour an icon apart from its words, except a warning in `--danger`.
- **Don't** use the mark as an icon, or an emoji anywhere.
