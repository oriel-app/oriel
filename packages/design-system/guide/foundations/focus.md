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

These rules change the ring. Each was written for a reason, but together they give Oriel's fields five focus looks.

| Rule                                                                                   | What it does                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.cluster-toggle:focus-visible` in `window.css`                                        | The ring 2px **inside**, since the row fills the clipped list                                          |
| `.settings :is(.input, .select):focus-visible` in `window.css`                         | Offset 0: the ring on the field's edge                                                                 |
| `.ask-input:focus` in `window.css`                                                     | Its own ring, 1px inside, on **`:focus`**, so a mouse click shows it too                               |
| `.composer:focus-within` and `.composer textarea:focus` in `window.css`                | No ring. The composer's 1px border tints half way to the accent                                        |
| `.workstream-title:focus` in `window.css`                                              | No ring. The name's border turns `--line-strong` and it fills with `--surface`                         |
| `.sidebar-search-field:focus-within` and `.filter-search:focus-within` in `window.css` | The frame's border in `--focus`, plus a 1px ring; the input's own outline off. Written twice, the same |
| `.context-menu-item:is(:hover, :focus-visible)` in `window.css`                        | No ring. A `--surface-hover` fill, the same as hover                                                   |

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

```html specimen id=override-ask title="The ask bar: its own ring, inside, on any focus" state=focus
<form class="ask-bar">
  <input
    type="text"
    class="ask-input ws-focus"
    placeholder="Ask about your window"
    aria-label="Ask about your window"
  /><button type="submit" class="button primary" disabled>Ask</button>
</form>
```

```html specimen id=override-composer title="The composer: a 1px tint, the weakest in the app" state=focus-within
<form class="composer ws-focus-within">
  <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea
  ><button type="submit" class="button primary" disabled>Send</button>
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

- **The composer** is the app's most-used field, and its focus is the hardest to see. The tinted border is 3.5:1 to 3.9:1 against `--surface` in light (Graphite and Broadsheet) and 3.8:1 to 4.2:1 in dark, but it's 1px, and it changes from its rest colour by only 1.6:1 to 2.3:1.
- **The context menu** shows focus exactly as it shows hover. With the pointer resting on one item and the arrow keys on another, two items are lit and nothing says which one Enter acts on.
- **The ask bar** shows its ring on a mouse click, unlike every other control, because it uses `:focus`.
- **The workstream's name** shows focus only as a `--line-strong` border, 1.8:1 to 2.4:1 against the surface.

## Proposed: one field-frame focus

Proposed, not in Oriel yet. A field that's a frame round an input (the composer, the ask bar, the two searches) shows focus on the frame: its border in `--focus` and a 1px ring outside it, on `:focus-within`. That's the look the sidebar's search already has, so it's one look extended, not a new one. A plain text field shows the same on itself. The inner input turns its own outline off, because the frame carries it.

It's written in this workshop's proposals: `.chat-input:focus-within` in `assets/proposals/chat-input.css`, and `.text-field-input:focus-visible` and `.search-field:focus-within` in `assets/proposals/field.css`. See [Chat input](/components/chat-input) and the [text field lab](/lab/text-field).

Everything that isn't a field keeps the window's ring. Two more changes go with it:

- `.context-menu-item` keeps its fill on hover, but takes an inset ring on `:focus-visible` (offset `calc(-1 * var(--border-thick))`), as `.cluster-toggle` does.
- `.ask-input` moves from `:focus` to the frame.

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

## Rules

- **Do** leave the window's ring alone on any control that isn't a field.
- **Do** use `:focus-visible`, never `:focus`, for how focus looks.
- **Do** move the ring inside (`outline-offset` negative) only for a full-width row in a clipped list.
- **Do** show a field's focus on its frame, in `--focus`, if the field is a frame round an input.
- **Don't** write `outline: none` without drawing focus another way at 3:1, in the same rule or the frame's.
- **Don't** show focus as a fill alone: it reads as hover.
- **Don't** clip a ring: a parent with `overflow: hidden` cuts the 2px offset off. The swipe row clips only while it moves for this reason (`.swipe:is([data-open], [data-dragging])` in `window.css`).
- **Don't** put a ring on something the app focuses for a screen reader, such as a change set or a panel title.
