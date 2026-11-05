---
title: Icon button
status: drifting
group: Actions
order: 11
classes: head-action, panel-step, panel-close, window-chat-close, remove-member, remove-line, sync-now, sidebar-fold, bar-menu, nav-disclose, sidebar-new
summary: A square button that shows only an icon or a ×, named by its aria-label and explained by a tooltip. Nine classes today and no shared one; copy .head-action.
---

# Icon button

## What it is

A square, borderless button whose face is an icon (or a `×`), not a word. Its name lives in `aria-label` (or a `.visually-hidden` span), and a [tooltip](/components/tooltip) says it to a pointer. It sits where a word wouldn't fit or would shout: a header's edge, a panel's corner, the end of a row.

Oriel has no shared icon-button class. Each place wrote its own:

| Class                            | Where                                                       | Size                      | Face               |
| -------------------------------- | ----------------------------------------------------------- | ------------------------- | ------------------ |
| `.head-action`                   | A workstream's header: Mark done or Reopen, and Delete…     | `--head-row` (2rem)       | SVG `.icon`        |
| `.panel-step`                    | The item panel: Previous item, Next item                    | `--head-row`              | SVG `.icon`        |
| `.panel-close`                   | The item panel: Close the panel                             | `--head-row`              | `×` at `--text-xl` |
| `.window-chat-close`             | The window chat: Close the chat                             | 1.75rem                   | `×` at `--text-xl` |
| `.remove-member`, `.remove-line` | A workstream's item row; a change set's line                | 1.5rem                    | `×` at `--text-lg` |
| `.sync-now`                      | A thread's right rail: Sync this thread with its workstream | 1.75rem                   | SVG `.icon`        |
| `.sidebar-fold`, `.bar-menu`     | The sidebar's head; the narrow bar's menu                   | 1.75rem; `.bar-menu` 2rem | SVG `.icon`        |
| `.nav-disclose`                  | A sidebar workstream: Show or Hide its threads              | 1.25 × 1.875rem           | `.chevron`         |
| `.nav-link.sidebar-new` (a link) | The sidebar, beside search: New thread                      | 1.875rem                  | SVG `.icon`        |

**For a new icon button, copy `.head-action`** (`EndButtons` in `packages/web/src/end-workstream.tsx`): `--head-row` square, `--text-muted` at rest, hover guarded by `:not(:disabled)`, a `[data-danger]` hover, `opacity: 0.5` when disabled, an SVG `.icon`, an `aria-label` naming the action and its object, and a `Tooltip`. Until the proposed `IconButton` lands, that means a new class beside it with the same rules, or reusing `.head-action` where the place is a header.

## When to use it

- In a header row or a corner, for an action whose icon everyone reads: close, previous and next, show or hide the sidebar, sync.
- For a repeat action on every row, where a word on each row would be noise: remove an item from a workstream, leave a change out.
- Beside a title, for actions that also live in its [context menu](/components/menu): Mark done and Delete… on a workstream's header are the same items as its menu (`EndButtons` in `packages/web/src/end-workstream.tsx`), so the two can't drift apart.

## When not to

- Not where a word fits. A thread's Mark done is a word (`.quiet-action`, see [Button](/components/button)), and so is New chat in the window chat. Words are clearer than icons, and most actions read better as words.
- Not for an action the person has to discover. An icon with no word works for close, back and forward; it doesn't work for Share review link.
- Not without a tooltip. Every icon button but the window chat's close and the bar's menu has one, and those two are gaps, not a pattern.
- Not for the first step of a destructive action that can't be undone without asking. The header's Delete… icon opens the one question a delete asks; it doesn't delete. See [Destructive actions and undo](/patterns/destructive-actions).
- Not as a link styled as a button, except `.sidebar-new`, which goes to a page (New thread) and so is a link that looks like an icon button.

## Anatomy and variants

A button with no border and no fill, an icon centred in it (`display: inline-grid; place-items: center`), the corner `--radius`. The icon is a 16-unit SVG with `class="icon"` and `aria-hidden="true"`: 1rem, stroked in `currentColor` at 1.4 (see [Icons](/foundations/icons)). Its colour comes from the button, so hover changes both together.

```html specimen id=copy-this title="The one to copy: .head-action, with its tooltips"
<div class="workstream-title-row">
  <input
    class="workstream-title"
    value="Checkout v2: phone wallets and saved cards"
    aria-label="Workstream name"
  />
  <div class="workstream-actions">
    <button
      type="button"
      class="head-action"
      aria-label="Mark done: Checkout v2: phone wallets and saved cards"
      aria-describedby="tip-done"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
      </svg>
    </button>
    <span id="tip-done" role="tooltip" popover="manual" class="tooltip">Mark done</span>
    <button
      type="button"
      class="head-action"
      data-danger
      aria-label="Delete Checkout v2: phone wallets and saved cards…"
      aria-describedby="tip-delete"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
        />
      </svg>
    </button>
    <span id="tip-delete" role="tooltip" popover="manual" class="tooltip">Delete…</span>
  </div>
</div>
```

```html specimen id=all-today title="Every square icon button today, at rest"
<div class="ws-stack">
  <p class="ws-note">On --head-row: head actions, panel steps, the panel's close</p>
  <div class="ws-row">
    <button type="button" class="head-action" aria-label="Mark done: Gift cards">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
      </svg>
    </button>
    <button type="button" class="head-action" aria-label="Reopen: Gift cards">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2" />
        <path d="M3.25 4.25v3.5h3.5" />
      </svg>
    </button>
    <button type="button" class="panel-step" aria-label="Previous item">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 9.75L8 6.25l3.5 3.5" />
      </svg>
    </button>
    <button type="button" class="panel-step" aria-label="Next item">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 6.25L8 9.75l3.5-3.5" />
      </svg>
    </button>
    <button type="button" class="panel-close" aria-label="Close the panel">×</button>
  </div>
  <p class="ws-note">
    1.75rem: Sync now, the sidebar's fold, the window chat's close; the bar's menu, 2rem
  </p>
  <div class="ws-row">
    <button type="button" class="sync-now" aria-label="Sync this thread with its workstream">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
        />
        <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
      </svg>
    </button>
    <button type="button" class="sidebar-fold" aria-controls="sidebar" aria-expanded="true">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M6 2.5v11" />
      </svg>
      <span class="visually-hidden">Hide sidebar</span>
    </button>
    <button type="button" class="window-chat-close" aria-label="Close the chat">×</button>
    <button type="button" class="bar-menu" aria-controls="sidebar" aria-expanded="false">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      </svg>
      <span class="visually-hidden">Open the sidebar</span>
    </button>
  </div>
  <p class="ws-note">Their own sizes: a sidebar workstream's disclosure, New thread (a link)</p>
  <div class="ws-row">
    <button
      type="button"
      class="nav-disclose"
      aria-expanded="false"
      aria-controls="nav-threads-gift"
    >
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      <span class="visually-hidden">Show threads in Gift cards</span>
    </button>
    <a class="sidebar-new nav-link" href="/threads/new" aria-label="New thread">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
    </a>
  </div>
</div>
```

```html specimen id=panel-head title="A close in its place: the item panel's head"
<header class="panel-head">
  <p class="panel-source">Jira · SYN-23</p>
  <button
    type="button"
    class="panel-close"
    aria-label="Close the panel"
    aria-describedby="tip-close"
  >
    ×
  </button>
  <span id="tip-close" role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
</header>
```

The two removes are hidden until their row is hovered or they have keyboard focus (`.member:hover .remove-member` in `window.css`), and show at 0.6 on a touch screen, which can't hover (`@media (hover: none)` in `window.css`). Hover is forced on the rows below.

```html specimen id=removes title="Removes: on a workstream's item row, and on a change set's line"
<div class="ws-stack">
  <ul class="members">
    <li class="member ws-hover" data-item="jira:SYN-23">
      <span class="type" data-type="story" title="Story"></span>
      <a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a>
      <span class="member-title">Pay with a phone wallet on the website</span>
      <span class="status" data-category="in-progress">In Progress</span>
      <button
        type="button"
        class="remove-member"
        aria-label="Remove SYN-23"
        aria-describedby="tip-remove"
      >
        ×
      </button>
      <span id="tip-remove" role="tooltip" popover="manual" class="tooltip"
        >Remove SYN-23 from this workstream</span
      >
    </li>
    <li class="member" data-item="jira:SYN-21">
      <span class="type" data-type="story" title="Story"></span>
      <a class="key source-link" href="https://example.atlassian.net/browse/SYN-21">SYN-21</a>
      <span class="member-title">Update the payment declined error message</span>
      <span class="status" data-category="in-progress">In Progress</span>
      <button type="button" class="remove-member" aria-label="Remove SYN-21">×</button>
    </li>
  </ul>
  <ul class="diff">
    <li class="diff-line ws-hover" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Move “Pay with a phone wallet on the website” from In Progress to Done.
          <a class="key source-link" href="https://example.atlassian.net/browse/SYN-23"
            >SYN-23</a
          ></span
        >
      </p>
      <button type="button" class="remove-line" aria-label="Leave this change out">×</button>
    </li>
  </ul>
</div>
```

## States

Hover and focus here are forced with `ws-hover` and `ws-focus-visible`, which carry window.css's own `:hover` and `:focus-visible` rules. Tab into any specimen to see the real ones, and rest the pointer on a button that has a tooltip.

```html specimen id=state-hover title="Hover: most fill and darken; the window chat's close only fills; the disclosure only darkens" state=hover
<div class="ws-row">
  <button type="button" class="head-action ws-hover" aria-label="Mark done: Gift cards">
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
  <button type="button" class="panel-step ws-hover" aria-label="Next item">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 6.25L8 9.75l3.5-3.5" />
    </svg>
  </button>
  <button type="button" class="panel-close ws-hover" aria-label="Close the panel">×</button>
  <button type="button" class="window-chat-close ws-hover" aria-label="Close the chat">×</button>
  <button type="button" class="sync-now ws-hover" aria-label="Sync this thread with its workstream">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5" />
      <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
    </svg>
  </button>
  <button type="button" class="nav-disclose ws-hover" aria-expanded="false">
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
    <span class="visually-hidden">Show threads in Gift cards</span>
  </button>
</div>
```

```html specimen id=state-focus title="Focus visible: the global ring" state=focus-visible
<div class="ws-row">
  <button type="button" class="head-action ws-focus-visible" aria-label="Mark done: Gift cards">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
    </svg>
  </button>
  <button type="button" class="panel-close ws-focus-visible" aria-label="Close the panel">×</button>
  <button type="button" class="sidebar-fold ws-focus-visible" aria-expanded="true">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
    <span class="visually-hidden">Hide sidebar</span>
  </button>
  <button type="button" class="remove-member ws-focus-visible" aria-label="Remove SYN-23">×</button>
</div>
```

```html specimen id=state-disabled title="Disabled: 0.5, 0.35, or (the change set's ×) nothing at all" state=disabled
<div class="ws-stack">
  <div class="ws-row">
    <button type="button" class="head-action" disabled aria-label="Mark done: Gift cards">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" />
        <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
      </svg>
    </button>
    <button type="button" class="panel-step" disabled aria-label="Previous item">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 9.75L8 6.25l3.5 3.5" />
      </svg>
    </button>
    <button
      type="button"
      class="sync-now"
      aria-disabled="true"
      aria-label="Sync this thread with its workstream"
      aria-describedby="tip-sync-waits"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
        />
        <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
      </svg>
    </button>
    <span id="tip-sync-waits" role="tooltip" popover="manual" class="tooltip"
      >Syncs once the agent has answered</span
    >
  </div>
  <p class="ws-note">
    A disabled .remove-line, while its change set is busy, still shows and still turns red under the
    pointer:
  </p>
  <ul class="diff">
    <li class="diff-line ws-hover" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Move “Give the map pins accessible labels” from In Progress to Done.</span
        >
      </p>
      <button
        type="button"
        class="remove-line ws-hover"
        disabled
        aria-label="Leave this change out"
      >
        ×
      </button>
    </li>
  </ul>
</div>
```

```html specimen id=state-busy title="Busy: Sync now pulses its icon while it syncs" state=busy
<p class="rail-note">
  Workstream will update on next
  <span class="rail-note-end"
    >send<button
      type="button"
      class="sync-now"
      aria-label="Sync this thread with its workstream"
      aria-disabled="true"
      aria-busy="true"
      aria-describedby="tip-syncing"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
        />
        <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
      </svg></button
    ><span id="tip-syncing" role="tooltip" popover="manual" class="tooltip">Syncing…</span></span
  >
</p>
```

```html specimen id=state-expanded title="Expanded and with a count: the fold, the bar's menu and the disclosure" state=expanded
<div class="ws-row">
  <button type="button" class="sidebar-fold" aria-controls="sidebar" aria-expanded="false">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
    <span class="visually-hidden">Show sidebar, 3 threads waiting on you</span>
    <span class="bar-count" aria-hidden="true">3</span>
  </button>
  <button type="button" class="bar-menu" aria-controls="sidebar" aria-expanded="false">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
    <span class="visually-hidden">Open the sidebar, 3 threads waiting on you</span>
    <span class="bar-count" aria-hidden="true">3</span>
  </button>
  <button
    type="button"
    class="nav-disclose"
    aria-expanded="true"
    aria-controls="nav-threads-checkout"
  >
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
    <span class="visually-hidden">Hide threads in Checkout v2: phone wallets and saved cards</span>
  </button>
</div>
```

- **Rest:** transparent, `--text-muted` (`--text-faint` for the fold, the bar's menu before its own override, the disclosure and the removes).
- **Hover:** `--surface-hover` fill and `--text`, on most. The window chat's close fills but keeps its colour (`.window-chat-close:hover` in `window.css`). The disclosure only darkens (`button.nav-disclose:hover` in `window.css`). The removes and the header's Delete turn `--danger`, the removes on a `--danger-soft` fill.
- **Focus visible:** the global ring, `--border-thick` in `--focus`, 2px out (`:focus-visible` in `window.css`). A remove shows when it has focus, so the keyboard reaches it.
- **Active:** not styled, as nowhere in window.css.
- **Disabled:** three looks. `.head-action` 0.5, `.panel-step` 0.35 (`.panel-step:disabled` in `window.css`), `.sync-now` 0.5 through `aria-disabled`, which keeps it focusable so its tooltip says why. `.remove-line` can be disabled (`Diff` in `packages/web/src/thread-page.tsx`) but has no disabled rule, and its hover isn't guarded: it looks live (last specimen above). `.panel-close`, `.window-chat-close` and the sidebar's are never disabled.
- **Busy:** only `.sync-now`, which sets `aria-busy` and pulses its icon (`.sync-now[aria-busy] .icon` in `window.css`), held still under reduced motion (`@media (prefers-reduced-motion: reduce)` in `window.css`).
- **Expanded:** `.sidebar-fold`, `.bar-menu` and `.nav-disclose` set `aria-expanded`. Only the disclosure shows it, by turning its chevron (`.nav-disclose[aria-expanded="true"] .chevron` in `window.css`).
- **Error** and **empty** don't apply.

## Keyboard and ARIA

- A native `<button type="button">`, in the tab order; Enter and Space press it. `.sidebar-new` is an `<a>` and follows on Enter.
- **Name:** `aria-label`, written as the action and its object: "Remove SYN-23", "Close the panel", "Mark done: Checkout v2: phone wallets and saved cards". The fold and the bar's menu use a `.visually-hidden` span instead, so they can add ", 3 threads waiting on you" while the visible count stays `aria-hidden`. Either works; pick `aria-label` for a new one.
- **Tooltip:** wrap it in `Tooltip` in `packages/web/src/tooltip.tsx`. Where the tip says more than the name ("Close (Esc)" beside "Close the panel"), it becomes the button's description; where it repeats the name, it's hidden from screen readers. See [Tooltip](/components/tooltip).
- **Shortcuts:** Esc closes the item panel, and ↑ and ↓ step through its list; the tooltips say so ("Previous (↑)", "Close (Esc)"). ⌘\ (Ctrl+\ off a Mac) folds the sidebar. None of them sets `aria-keyshortcuts`. The window chat's close looks the same as the panel's but doesn't answer Esc.
- **Disabled but focusable:** prefer `aria-disabled="true"` with a guarded click, as Sync now does (`Region` in `packages/web/src/thread-page.tsx`), when the tooltip explains why it can't be pressed. A `disabled` button leaves the tab order, and its tooltip with it.
- **Disclosure:** `.nav-disclose`, `.sidebar-fold` and `.bar-menu` carry `aria-expanded` and `aria-controls`.
- The icon is `aria-hidden="true"`, always.

## Content

- The `aria-label` is a verb and its object, in sentence case: "Remove SYN-23", "Leave this change out", "Sync this thread with its workstream". Not "×", "Close button" or "Icon".
- A label that opens a question ends in "…": "Delete Checkout v2: phone wallets and saved cards…".
- The tooltip may be shorter than the name and adds the shortcut in brackets: "Close (Esc)", "Next (↓)", "Hide the sidebar (⌘\)". It may also say why it waits: "Syncs once the agent has answered".
- A close or remove is the `×` character (U+00D7) today. The proposal draws it as an SVG, so its weight and baseline stop following the font.

## Where the app uses it

- `.head-action` in `window.css`, drawn by `EndButtons` in `packages/web/src/end-workstream.tsx`.
- `.panel-step` in `window.css`, drawn by `ItemPanel` in `packages/web/src/item-panel.tsx`.
- `.panel-close` in `window.css`, drawn by `ItemPanel` in `packages/web/src/item-panel.tsx`.
- `.window-chat-close` in `window.css`, drawn by `WindowChat` in `packages/web/src/window-chat-view.tsx`.
- `.remove-member` and `.remove-line` in `window.css`, which share one rule and are each placed by their own; drawn by `Member` in `packages/web/src/parts.tsx` and `Diff` in `packages/web/src/thread-page.tsx`.
- `.sync-now` in `window.css`, drawn by `Region` in `packages/web/src/thread-page.tsx`.
- `.sidebar-fold` and `.bar-menu` in `window.css`, which share one rule; the menu is resized by its own. The fold hides at 760px and narrower (`@media (max-width: 760px)` in `window.css`), where the bar and its menu show instead, so a narrow view of this page shows no fold. Drawn by `Sidebar` in `packages/web/src/sidebar.tsx` and `Bar` in `packages/web/src/app.tsx`.
- `.nav-disclose` in `window.css`, drawn by `WorkstreamEntry` in `packages/web/src/sidebar.tsx`.
- `.sidebar-new`, on a `.nav-link`: `.nav-link.sidebar-new` and `.nav-link` in `window.css`, drawn by `ThreadSearch` in `packages/web/src/sidebar.tsx`.

## Drift

Status **drifting**: nine classes for one control, about 145 lines of CSS.

- **Four sizes:** 1.5rem, 1.75rem, 2rem and `--head-row`. The item panel's close and the window chat's close both sit on a `--head-row` line, but one is 2rem and the other 1.75rem.
- **Three hovers:** fill and darken, fill only (`.window-chat-close`), darken only (`.nav-disclose`, written `button.nav-disclose:hover`).
- **Three disabled looks**, and one missing: `.remove-line` looks live while its change set is busy.
- **Two glyphs:** SVG icons, and the `×` text glyph at two sizes, `line-height: 1` on one close and not the other.
- **Two ways to name:** `aria-label`, or a `.visually-hidden` span.
- **Two tooltips missing:** the window chat's close and the bar's menu.
- `.bar-menu` is sized twice: 1.75rem with the fold, then 2rem on its own.

**Until it's consolidated, copy `.head-action`** with a `Tooltip`, and `aria-disabled` if the button can wait. Don't copy the `×` glyph for a new close: draw an SVG `.icon`.

**Proposed: one `IconButton`** in `parts.tsx`. It takes a `label` (always the `aria-label`), an `icon`, an optional `tip` and `keys` (the tooltip's text and shortcut, also set as `aria-keyshortcuts`), a `size` of `sm` (1.75rem, inline like Sync now) or `md` (`--head-row`), a `tone` of `danger`, and `disabled` and `busy`, rendered as `aria-disabled` and `aria-busy` so it keeps focus and its tip. It draws `<button class="icon-button" data-size>` inside a `Tooltip`, with a `CloseIcon` in place of the `×`. Every class above moves to it, keeping its old name only as a hook where code or shots select it (`.remove-member`, `.bar-menu`, `.sync-now`). It isn't specimened here because it would only restate `.head-action`. The size, migration and risks are in [the drift report](/drift) (btn:B2 and btn:B3).
