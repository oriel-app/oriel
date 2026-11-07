---
title: Focus
order: 50
summary: One focus ring, in the accent, 2px out. Where Oriel overrides it today, the five looks its fields have, and the one field-frame focus proposed.
---

# Focus

A keyboard user's place on the page must always show. Oriel draws it with one rule, and most controls should never touch it.

## The ring

```css
:focus-visible {
  outline: var(--border-thick) solid var(--focus);
  outline-offset: 2px;
}
```

That's `:focus-visible` in `window.css`, and it's the only global focus style.

- **`:focus-visible`, not `:focus`.** The browser shows the ring when focus came from the keyboard, or lands in a text field, and not on a mouse click on a button.
- **`--border-thick` (2px) in `--focus`.** `--focus` is the accent (`--focus` in `window.css`): the person's own place is drawn in "your move".
- **2px out.** The offset leaves a gap of the background between the control and the ring, so the ring reads on a primary button, whose fill is the accent too.
- **An outline, not a border or shadow.** It takes no room, so nothing shifts on focus, and Windows' forced colours keep it.

```html specimen id=ring title="The ring on a button, a primary, a quiet action, a link and a checkbox" state=focus-visible
<div class="ws-row">
  <button type="button" class="button ws-focus-visible">Reject</button>
  <button type="button" class="button primary ws-focus-visible">Approve and apply</button>
  <button type="button" class="quiet-action ws-focus-visible">Mark done</button>
  <a class="ws-focus-visible" href="#syn-23">SYN-23</a>
  <label class="ws-row"
    ><input type="checkbox" class="ws-focus-visible" aria-label="Pick SYN-23" /> Pick</label
  >
</div>
```

### Its contrast

The ring needs 3:1 against whatever it sits on (WCAG 1.4.11). The workshop claims that for `--focus` on every background, in every theme and scheme, and checks it with Oriel's own contrast code. The closest is `--focus` on `--surface-hover` in Broadsheet light, 5.25:1. See [Colour › Contrast](/foundations/colour#contrast) for the full table.

## Every override today

These rules change the ring. Each was written for a reason, but together they give Oriel's fields four focus looks. The chat inputs share one since ChatInput (DRIFT D3), the field-frame look proposed below.

| Rule                                                                                   | What it does                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.cluster-toggle:focus-visible` in `window.css`                                        | The ring 2px **inside**, since the row fills the clipped list                                          |
| `.settings :is(.input, .select):focus-visible` in `window.css`                         | Offset 0: the ring on the field's edge                                                                 |
| `.chat-input:focus-within` and `.chat-input-field:focus-visible` in `window.css`       | Every chat input (DRIFT D3): the frame's border in `--focus`, plus a 1px ring; the field's outline off |
| `.workstream-title:focus` in `window.css`                                              | No ring. The name's border turns `--line-strong` and it fills with `--surface`                         |
| `.sidebar-search-field:focus-within` and `.filter-search:focus-within` in `window.css` | The frame's border in `--focus`, plus a 1px ring; the input's own outline off. Written twice, the same |
| `.context-menu-item:is(:hover, :focus-visible)` in `window.css`                        | No ring. A `--surface-hover` fill, the same as hover                                                   |
| `.bead-action:focus-visible` in `window.css`                                           | The ring 2px **inside**, in `--focus`: the bead's room under the band is tight                         |

Three more remove the ring on purpose, and should stay that way. A change set, the item panel's title and the sidebar's Needs you take focus from the app (`tabIndex={-1}`) so a screen reader starts there. They aren't controls, and a ring would mark something nobody tabbed to (`.change-set:focus`, `.panel-title:focus` and `.sidebar-needs` in `window.css`).

Each, forced on (the workshop's `ws-focus-visible`, `ws-focus` and `ws-focus-within` classes carry window.css's own rules):

```html specimen id=override-inset title="Browse's cluster toggle: the ring inside" state=focus-visible
<section class="cluster">
  <h2 class="cluster-head">
    <button type="button" class="cluster-toggle ws-focus-visible" aria-expanded="false">
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      <span class="cluster-name">
        <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
        <span class="key">SYN-1</span>
      </span>
    </button>
  </h2>
</section>
```

```html specimen id=override-settings title="A Settings field: offset 0" state=focus-visible
<div class="settings">
  <label class="provider-path-label">
    <span>Path to Claude Code</span>
    <input
      type="text"
      class="input ws-focus-visible"
      placeholder="/opt/homebrew/bin/claude"
      spellcheck="false"
      autocomplete="off"
    />
  </label>
</div>
```

```html specimen id=override-chat-input title="Every chat input: the frame shows it" state=focus-within
<form class="chat-input ws-focus-within" data-lines="grow">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about 17 items…"
    aria-label="Message"
  ></textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 17 items · v3</span>
    <button type="submit" class="button" disabled>Send</button>
  </div>
</form>
```

```html specimen id=override-title title="The workstream's name: a border, no ring" state=focus
<div class="workstream-title-row">
  <input
    class="workstream-title ws-focus"
    value="Checkout v2: phone wallets and saved cards"
    aria-label="Workstream name"
  />
</div>
```

```html specimen id=override-search title="The sidebar's search: the frame shows it" state=focus-within
<div class="sidebar-search-row">
  <label class="sidebar-search-field ws-focus-within">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search threads</span>
    <input type="text" autocomplete="off" spellcheck="false" placeholder="Search threads" />
  </label>
</div>
```

```html specimen id=override-menu title="A context menu item: a fill, the same as hover" state=focus-visible height=120
<div
  popover="manual"
  data-ws-open
  role="menu"
  aria-label="Actions for Estimate the unestimated checkout stories"
  class="context-menu"
  style="left: 16px; top: 16px"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item ws-focus-visible">
    Mark done
  </button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

### What's wrong with them

- **The context menu** shows focus exactly as it shows hover. With the pointer resting on one item and the arrow keys on another, two items are lit and nothing says which one Enter acts on.
- **The workstream's name** shows focus only as a `--line-strong` border, 1.8:1 to 2.4:1 against the surface.

## Proposed: one field-frame focus

In Oriel for the chat inputs (DRIFT D3); proposed for the rest. A field that's a frame round an input (the composer, the ask bar, the two searches) shows focus on the frame: its border in `--focus` and a 1px ring outside it, on `:focus-within`. That's the look the sidebar's search already has, so it's one look extended, not a new one. A plain text field shows the same on itself. The inner input turns its own outline off, because the frame carries it.

The chat inputs have it: `.chat-input:focus-within` in `window.css`. The rest is in this workshop's proposals: `.text-field-input:focus-visible` and `.search-field:focus-within` in `assets/proposals/field.css`. See [Chat input](/components/chat-input) and the [text field lab](/lab/text-field).

Everything that isn't a field keeps the window's ring. Two more changes go with it:

- `.context-menu-item` keeps its fill on hover, but takes an inset ring on `:focus-visible` (offset `calc(-1 * var(--border-thick))`), as `.cluster-toggle` does.

The drift report also suggests naming the ring's parts on `html`: `--focus-ring: var(--border-thick) solid var(--focus)`, `--focus-offset: 2px` and `--focus-inset`, so the inset rings share one value. That's the maintainer's call.

```html specimen id=proposed-frames title="Proposed: the frame shows focus, for every field" side=proposed state=focus-within
<div class="ws-stack">
  <form class="chat-input ws-focus-within" data-lines="grow">
    <textarea
      class="chat-input-field"
      rows="2"
      placeholder="Ask about 17 items…"
      aria-label="Message"
    ></textarea
    ><button type="submit" class="button primary" disabled>Send</button>
  </form>
  <label class="search-field ws-focus-within">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search threads</span>
    <input
      class="search-field-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search threads"
    />
  </label>
  <div class="text-field">
    <label class="text-field-label" for="focus-name">Your name</label>
    <input
      id="focus-name"
      class="text-field-input ws-focus-visible"
      type="text"
      value="Amara Okafor"
    />
  </div>
</div>
```

## Keys the whole window owns

Two keys work from anywhere in the window, so no page or component may bind them:

- **F8** takes focus to [the bead](/components/bead#keyboard-and-aria)'s newest action, a text field included, and Escape takes it back to where it was (`UndoStack` in `packages/web/src/undo-stack.tsx`). The bead's wrap says so with `aria-keyshortcuts="F8"`. A keydown handler must let F8 through.
- **⌘Z** (Ctrl+Z) undoes the bead's newest note, except in a text field, which undoes its own typing.

## Rules

- **Do** leave the window's ring alone on any control that isn't a field.
- **Do** use `:focus-visible`, never `:focus`, for how focus looks.
- **Do** move the ring inside (`outline-offset` negative) only for a full-width row in a clipped list.
- **Do** show a field's focus on its frame, in `--focus`, if the field is a frame round an input.
- **Don't** write `outline: none` without drawing focus another way at 3:1, in the same rule or the frame's.
- **Don't** show focus as a fill alone: it reads as hover.
- **Don't** clip a ring: a parent with `overflow: hidden` cuts the 2px offset off. The swipe row clips only while it moves for this reason (`.swipe:is([data-open], [data-dragging])` in `window.css`).
- **Don't** put a ring on something the app focuses for a screen reader, such as a change set or a panel title.
