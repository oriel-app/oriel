---
title: Tooltip
status: drifting
group: Overlays
order: 50
classes: tooltip
summary: A short note on a control, shown a moment after the pointer rests on it and at once on keyboard focus. Oriel's Tooltip component, beside the native title attributes many marks still use.
---

# Tooltip

## What it is

A small box of text about one control: what it does in more words, or its shortcut. It's `Tooltip` in `packages/web/src/tooltip.tsx`: "It shows a moment after the pointer rests on the control, and at once when the keyboard focuses it; it goes when either leaves, on a click, on a scroll, or on Escape. Touch shows nothing, so what it says that matters is in the control's name or on the page already."

It's a `popover="manual"` with `role="tooltip"`, in the top layer, so no scroll or slide clips it, and `pointer-events: none`, so the pointer passes through it. The surface is `--surface` with a `--line` border, `--radius-sm`, `--shadow`, `--text-sm` at line-height 1.35, and at most `min(18rem, 100vw - 2 × --space-2)` wide (`.tooltip` in `window.css`). It has no arrow.

Many marks still use the browser's own `title` attribute instead: chips, state dots, counts, status bars, type marks, times. A native title looks like the operating system's, waits longer, and never shows on keyboard focus.

## When to use it

- On every [icon button](/components/icon-button): its name is invisible, so the tooltip says it to a pointer.
- To give a control's shortcut: "Close (Esc)", "Previous (↑)", "Hide the sidebar (⌘\)".
- To say more than the control's label has room for: "Make a workstream of all 12 items in Checkout v2: phone wallets and saved cards as they are now", "New thread: start from nothing, such as a plan for a new epic".
- To say why a control waits: Sync workstream now's "Syncs once the agent has answered".

## When not to

- Not for anything a person needs to do their work. Touch shows nothing, and a screen reader may skip a tip that repeats the name. Put it in the label or on the page.
- Not on something that isn't focusable. A tooltip is on a control; a tip on a dot or a word can't be reached by keyboard. That's why the marks below use `title`, and why their words have to be on the page too.
- Not for rich content: no links, buttons, lists or headings. It's one short sentence or a phrase, and the pointer passes through it.
- Not as a help box or an error. A problem is a line under the thing (see [Empty, loading and error](/components/states)); a longer explanation is text on the page.
- Not a second tooltip on a control that has a native `title`. Pick `Tooltip`.

## Anatomy and variants

Oriel renders the control, then the tooltip as its next sibling: the tip finds its control as its `previousElementSibling` (`Tooltip` in `packages/web/src/tooltip.tsx`). When it shows, `placeTooltip` puts it 6px above the control, centred on it and kept 8px from the window's edges, or below the control when there's no room above (`placeTooltip` in `packages/web/src/tooltips.ts`). It sets `top` and `left` in viewport pixels and `data-side` to `above` or `below`. Nothing styles `data-side`.

These two are shown open, at the place `placeTooltip` gives them:

```html specimen id=open-above title="Open, above its control: the item panel's Next" height=150
<div class="ws-stack">
  <p class="ws-note">Pointer on Next:</p>
  <div class="ws-row">
    <button type="button" class="panel-step" aria-label="Previous item" aria-describedby="tip-prev">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 9.75L8 6.25l3.5 3.5" />
      </svg>
    </button>
    <span id="tip-prev" role="tooltip" popover="manual" class="tooltip">Previous (↑)</span>
    <span class="panel-place">3 of 12</span>
    <button
      type="button"
      class="panel-step ws-hover"
      aria-label="Next item"
      aria-describedby="tip-next"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 6.25L8 9.75l3.5-3.5" />
      </svg>
    </button>
    <span
      id="tip-next"
      role="tooltip"
      popover="manual"
      class="tooltip"
      data-side="above"
      data-ws-open
      style="top: 13px; left: 127px"
      >Next (↓)</span
    >
  </div>
</div>
```

```html specimen id=open-below title="Open, below: no room above, as for the sidebar's fold at the top of the window" height=110
<button
  type="button"
  class="sidebar-fold ws-hover"
  aria-controls="sidebar"
  aria-expanded="true"
  aria-describedby="tip-fold"
>
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </svg>
  <span class="visually-hidden">Hide sidebar</span>
</button>
<span
  id="tip-fold"
  role="tooltip"
  popover="manual"
  class="tooltip"
  data-side="below"
  data-ws-open
  style="top: 50px; left: 8px"
  >Hide the sidebar (⌘\)</span
>
```

The `style` and `data-side` are what the component writes as it shows the tip; don't write them yourself. In your markup, the tip is only `<span id role="tooltip" popover="manual" class="tooltip">`.

Try these: rest the pointer on a control for 400ms, or Tab to it.

```html specimen id=live title="Live: hover for 400ms, or Tab to a control" height=170
<div class="ws-stack">
  <p class="ws-note">Above when there's room, below when there isn't:</p>
  <div class="ws-row">
    <button
      type="button"
      class="panel-close"
      aria-label="Close the panel"
      aria-describedby="tip-live-close"
    >
      ×
    </button>
    <span id="tip-live-close" role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
    <a
      class="sidebar-new nav-link"
      href="/threads/new"
      aria-label="New thread"
      aria-describedby="tip-live-new"
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
    </a>
    <span id="tip-live-new" role="tooltip" popover="manual" class="tooltip"
      >New thread: start from nothing, such as a plan for a new epic</span
    >
    <button type="button" class="sync-now" aria-label="Sync workstream now">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
        />
        <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
      </svg>
    </button>
    <span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
      >Sync workstream now</span
    >
    <button type="button" class="quiet-action" aria-describedby="tip-live-make">
      Make a workstream
    </button>
    <span id="tip-live-make" role="tooltip" popover="manual" class="tooltip"
      >Make a workstream of all 12 items in Checkout v2: phone wallets and saved cards as they are
      now</span
    >
  </div>
</div>
```

The third tip only repeats its control's name, so it's `aria-hidden` and the button has no `aria-describedby`: a screen reader hears the name once. The last shows the width cap: a long tip wraps at 18rem.

### Native titles, for comparison

```html specimen id=native-title title="Native title attributes: hover each for the browser's own box"
<div class="ws-row">
  <span class="state-dot" data-state="working" data-waiting="agent" title="Agent working"></span>
  <span class="type" data-type="bug" title="Bug"></span>
  <span class="nav-count" title="12 items">12</span>
  <span
    class="status-bar"
    role="img"
    aria-label="3 done, 2 in progress, 7 to do"
    title="3 done, 2 in progress, 7 to do"
    style="width: 4.5rem"
    ><span class="segment done" style="flex-grow: 3"></span
    ><span class="segment in-progress" style="flex-grow: 2"></span
    ><span class="segment todo" style="flex-grow: 7"></span
  ></span>
</div>
```

## States

- **Hidden:** the default. A closed popover isn't drawn and isn't in the accessibility tree, though its control's `aria-describedby` still points at it, so a screen reader reads the description whether it's shown or not.
- **Shown:** on pointer rest (400ms, `delay` in `packages/web/src/tooltip.tsx`), or at once on focus when the control matches `:focus-visible`. A click's focus doesn't show it.
- **Gone:** on pointer leave, pointer down, blur, any scroll, or Escape. Escape is caught on the way down and still does its other job, such as closing the item panel.
- **Touch:** a touch pointer never shows it.
- **Hover, focus, active, disabled** apply to the control, not the tip. A `disabled` button can't be focused, so its tip shows only on hover; Sync workstream now uses `aria-disabled` so its "Syncs once the agent has answered" reaches the keyboard too.
- **Motion:** none. It appears and goes at once; there's no fade to hold still under reduced motion.
- **Error, empty, loading:** don't apply.

## Keyboard and ARIA

- The tip is `role="tooltip"`, `popover="manual"`, with an `id` from `useId()`.
- If its text says more than the control's accessible name, the control gets `aria-describedby` pointing at it, so it's read after the name: "Close the panel, Close (Esc)". If it only repeats the name (compared with whitespace squashed, `repeatsName` in `packages/web/src/tooltips.ts`), the tip gets `aria-hidden="true"` and the control no description.
- It never takes focus and has nothing focusable in it.
- Escape hides it without stopping the key's other work.
- A native `title` is neither: it shows on hover only, after the browser's own delay, and screen readers treat it inconsistently. Don't rely on one to name anything.

## Content

- A phrase or one short sentence, sentence case, no full stop: "Remove SYN-23 from this workstream", "Leave this change out".
- A shortcut goes in brackets after the words: "Close (Esc)", "Next (↓)", "Hide the sidebar (⌘\)". Off a Mac, ⌘ becomes Ctrl (`modKey` in `packages/web/src/sidebar.tsx`).
- A tip that adds nothing to the name can still help a pointer on an icon button; it's hidden from screen readers automatically.
- A colon introduces more about the same thing: "New thread: start from nothing, such as a plan for a new epic".
- A waiting control says what it waits for: "Syncing…", "Syncs once the agent has answered".

## Where the app uses it

- The component: `Tooltip` in `packages/web/src/tooltip.tsx`; placement and the name check: `placeTooltip` and `repeatsName` in `packages/web/src/tooltips.ts`. CSS: `.tooltip` in `window.css`.
- The item panel: Previous, Next and Close (`ItemPanel` in `packages/web/src/item-panel.tsx`), and Add to "workstream" (`AddTo` in `packages/web/src/item-panel.tsx`).
- A workstream's header and rows: `EndButtons` in `packages/web/src/end-workstream.tsx` and `Member` in `packages/web/src/parts.tsx`.
- The sidebar: the fold, Search threads and New thread (`Sidebar` and `ThreadSearch` in `packages/web/src/sidebar.tsx`).
- Browse's Make a workstream: `Cluster` in `packages/web/src/window-page.tsx`.
- A thread: Leave this change out and Sync workstream now (`Diff` and `Region` in `packages/web/src/thread-page.tsx`).
- Native titles: chips (`Chip` in `packages/web/src/parts.tsx`), state dots and counts (`WorkstreamEntry` in `packages/web/src/sidebar.tsx`), the status bar (`StatusBar` in `packages/web/src/window-page.tsx`), type marks (`TypeMark` in `packages/web/src/parts.tsx`), times (`Stamp` in `packages/web/src/parts.tsx`).

## Drift

Status **drifting**: one `Tooltip` component, and the browser's `title` on everything that isn't a control.

- Two looks for one job: Oriel's box on controls, the system's on marks. The native one never shows to the keyboard.
- `data-side` is set and never styled.
- Its surface is `--radius-sm`; the context menu's, the other top-layer surface, is `--radius-lg`.
- One icon button has none: the narrow bar's menu.

**Until it's consolidated:** use `Tooltip` for any control. For a mark that isn't a control, keep `title` only as a convenience, and make sure the same words are on the page or in an accessible name.
