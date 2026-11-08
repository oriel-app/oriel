---
title: Context menu
status: stable
group: Overlays
order: 51
classes: context-menu, context-menu-item, member-menu, swipe, swipe-actions, swipe-action, swipe-row
summary: The actions on a thread or workstream row, opened by right-click, the Menu key or Shift+F10, with a swipe to show the same actions on touch and trackpads.
---

# Context menu

## What it is

A short list of actions on one thing, opened on that thing. In Oriel it's `ContextMenu` in `packages/web/src/menu.tsx`: "A right-click opens it at the pointer; with focus inside, the Menu key or Shift+F10 opens it under the focused element. Focus moves to its first item. The arrow keys move between items, Home and End jump to the ends, Escape or Tab closes it and gives focus back, and choosing an item closes it, then does what the item does."

It's a `popover="auto"` with `role="menu"`, in the top layer, so "neither the sidebar's scroll nor the drawer's slide clips or moves it", and a click outside closes it. Its surface is `--surface` with a `--line` border, `--radius-lg`, `--shadow` and `--space-1` padding; each item is a 1.875rem row with a `--radius-sm` corner (`.context-menu` and `.context-menu-item` in `window.css`).

Its touch twin is the **swipe** (`Swipeable` in `packages/web/src/swipe.tsx`): swipe a row left, on a touch screen or with two fingers on a trackpad, and the same actions show behind it as filled buttons. "The same actions are in the row's context menu, which is how a keyboard reaches them."

Two menus are about ending something (decision 0028), and two about moving an item ([Drag to move](/patterns/drag-to-move)):

- **ThreadMenu**, "Actions for {title}": Mark done (left out once the thread is done), and Delete… (`ThreadMenu` in `packages/web/src/close-thread.tsx`).
- **WorkstreamMenu**, "Actions for {name}": Mark done or Reopen, and Delete… (`WorkstreamMenu` in `packages/web/src/end-workstream.tsx`).
- **An item's row on a workstream's page**, "Move {key}": Move to “{name}” for each other open workstream, then Move to a new workstream (`movingOf` in `packages/web/src/workstream-page.tsx`). Its wrapper is `.member-menu`, `display: contents`, so the row's cells stay the row's grid.
- **The drop menu**, opened where an item dragged onto the sidebar's Workstreams heading was let go: Create new workstream, and Cancel (`Workstreams` in `packages/web/src/sidebar.tsx`).

The last opens with no right-click, so it is the menu alone: `Menu` in `packages/web/src/menu.tsx`, open at a point while `at` isn't null. `ContextMenu` is that same `Menu`, opened by a right-click or the keyboard.

## When to use it

- For actions on a row in a list, where a button on every row would be noise: a thread in the sidebar or a workstream's list, a workstream in the sidebar or the Done page.
- With a swipe as well, wherever the row is in the sidebar, which is where a phone or trackpad is used most.
- With the same items as a visible control elsewhere. A workstream's header shows Mark done and Delete… as [icon buttons](/components/icon-button), fed by the same list (`EndButtons` in `packages/web/src/end-workstream.tsx`), so the menu is never the only way.

## When not to

- Not as the only way to do something. A context menu has no visible trigger, so most people won't find it. Every action in Oriel's menus is also on the thing's own page.
- Not for picking a value. Browse's "Add to…" is a `<select>` (see [Select](/components/select)); a setting is a [radio](/components/checkbox-radio).
- Not for navigation. A row's click goes to the row's page; the menu is for actions on it.
- Not for more than a few actions. There's no separator, group, icon, check or shortcut hint today, because two or three items need none.
- Not for a destructive action that happens at once. Delete… ends in "…" because it opens the one question a delete asks ([Confirm](/components/confirm)).

## Anatomy and variants

```html specimen id=open title="Open, where a right-click left it" height=150
<ul class="thread-list">
  <li>
    <div>
      <a class="thread-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0">
        <span class="thread-link-title">Estimate the unestimated checkout stories</span>
        <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
        <span class="thread-link-at"><time datetime="2026-11-04T09:12:00Z">2 h ago</time></span>
      </a>
      <div
        popover="auto"
        role="menu"
        aria-label="Actions for Estimate the unestimated checkout stories"
        class="context-menu"
        data-ws-open
        style="left: 140px; top: 38px"
      >
        <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">
          Mark done
        </button>
        <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
          Delete…
        </button>
      </div>
    </div>
  </li>
</ul>
```

- **Menu** (`.context-menu`): at least 10rem wide. `inset: auto` and a `left` and `top` the component writes, in viewport pixels, kept 4px inside the window.
- **Item** (`.context-menu-item`): a `<button role="menuitem" tabindex="-1">`, full width, left-aligned, in the menu's text colour.
- **Danger item** (`[data-danger]`): `--danger` words, and a `--danger-soft` fill under the pointer or focus. Only Delete… has it.
- **Wrapper:** the component renders a `<div>` around the row, and the menu after the row inside it. The items exist only while the menu is open.

This one works. Right-click the row, or Tab to it and press Shift+F10 (or the Menu key); then ↑, ↓, Home, End, Escape and Tab. In the workshop a click opens it too; in the app a click follows the row's link.

```html specimen id=try-it title="Try it: right-click the row, or Shift+F10 on it" height=160
<ul class="thread-list">
  <li>
    <div>
      <a
        class="thread-link"
        href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W1"
        data-ws-menu="menu-gift-cards"
      >
        <span class="thread-link-title">Which gift card stories need a design?</span>
        <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
        <span class="thread-link-at"><time datetime="2026-11-03T16:05:00Z">yesterday</time></span>
      </a>
      <div
        id="menu-gift-cards"
        popover="auto"
        role="menu"
        aria-label="Actions for Which gift card stories need a design?"
        class="context-menu"
      >
        <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">
          Mark done
        </button>
        <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
          Delete…
        </button>
      </div>
    </div>
  </li>
</ul>
```

### The swipe, its touch twin

A row that swipes left shows its actions behind it, each 76px wide (`actionWidth` in `packages/web/src/swipe.tsx`), in the menu's order from the right edge: the first at the first stop, the rest "against some resistance, further on". They're filled: `--done` for a plain action, `--danger` for Delete…, with `--on-accent` words. The row slides by the actions' width.

```html specimen id=swipe title="A sidebar thread, swiped open, and one at rest" width=300
<ul class="nav-threads">
  <li>
    <div>
      <div class="swipe" data-open="true">
        <div class="swipe-actions" style="width: 152px" aria-hidden="false">
          <button type="button" class="swipe-action" style="width: 76px" tabindex="0">
            Mark done
          </button>
          <button type="button" class="swipe-action" data-danger style="width: 76px" tabindex="0">
            Delete…
          </button>
        </div>
        <div class="swipe-row" style="transform: translateX(-152px)">
          <a class="nav-link nav-thread" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W2">
            <span
              class="state-dot"
              data-state="working"
              data-waiting="agent"
              title="Agent working"
            ></span>
            <span class="nav-name">Draft the phone wallet stories</span>
          </a>
        </div>
      </div>
    </div>
  </li>
  <li>
    <div>
      <div class="swipe">
        <div class="swipe-actions" style="width: 0px" aria-hidden="true">
          <button type="button" class="swipe-action" style="width: 76px" tabindex="-1">
            Mark done
          </button>
          <button type="button" class="swipe-action" data-danger style="width: 76px" tabindex="-1">
            Delete…
          </button>
        </div>
        <div class="swipe-row">
          <a class="nav-link nav-thread" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W3">
            <span
              class="state-dot"
              data-state="working"
              data-waiting="review"
              title="Needs review"
            ></span>
            <span class="nav-name">Estimate the unestimated checkout stories</span>
          </a>
        </div>
      </div>
    </div>
  </li>
</ul>
```

## States

```html specimen id=state-hover-focus title="The pointer on Mark done, the keyboard on Delete…: both lit, and nothing says which Enter acts on" state=focus-visible height=150
<ul class="thread-list">
  <li>
    <div>
      <a class="thread-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0">
        <span class="thread-link-title">Estimate the unestimated checkout stories</span>
        <span class="thread-link-at"><time datetime="2026-11-04T09:12:00Z">2 h ago</time></span>
      </a>
      <div
        popover="auto"
        role="menu"
        aria-label="Actions for Estimate the unestimated checkout stories"
        class="context-menu"
        data-ws-open
        style="left: 140px; top: 38px"
      >
        <button type="button" role="menuitem" tabindex="-1" class="context-menu-item ws-hover">
          Mark done
        </button>
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="context-menu-item ws-focus-visible"
          data-danger
        >
          Delete…
        </button>
      </div>
    </div>
  </li>
</ul>
```

```html specimen id=state-swipe-focus title="A swipe action with keyboard focus: the ring is clipped by the open row" state=focus-visible width=300
<ul class="nav-threads">
  <li>
    <div>
      <div class="swipe" data-open="true">
        <div class="swipe-actions" style="width: 152px" aria-hidden="false">
          <button
            type="button"
            class="swipe-action ws-focus-visible"
            style="width: 76px"
            tabindex="0"
          >
            Mark done
          </button>
          <button type="button" class="swipe-action" data-danger style="width: 76px" tabindex="0">
            Delete…
          </button>
        </div>
        <div class="swipe-row" style="transform: translateX(-152px)">
          <a class="nav-link nav-thread" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W2">
            <span
              class="state-dot"
              data-state="working"
              data-waiting="agent"
              title="Agent working"
            ></span>
            <span class="nav-name">Draft the phone wallet stories</span>
          </a>
        </div>
      </div>
    </div>
  </li>
</ul>
```

- **Rest:** an item has no fill.
- **Hover** and **focus visible:** the same `--surface-hover` fill (`--danger-soft` on Delete…), and the focus ring is turned off (`.context-menu-item:is(:hover, :focus-visible)` in `window.css`). See "A maintainer's decision" below.
- **Active:** not styled.
- **Disabled:** there's no disabled item. An action that can't be taken is left out (Mark done on a done thread), which is right for a menu this short.
- **Open and closed:** the menu is in the top layer while open; its items aren't rendered while it's closed.
- **Busy, error, empty:** don't apply. A menu with no items doesn't open (`ContextMenu` in `packages/web/src/menu.tsx`). What an item does reports itself elsewhere: Delete… asks first; Mark done shows an [undo](/components/undo).
- **Swipe:** a swiped row clips itself (`overflow: hidden`) while it moves or is open, so a closed row's focus ring and current-page outline show in full (`.swipe:is([data-open], [data-dragging])` in `window.css`). The price is that an open row clips its own actions' focus ring. `.swipe-action` has no hover, focus or disabled rule of its own. Under reduced motion the row and its actions move without a transition (`@media (prefers-reduced-motion: reduce)` in `window.css`).

### A maintainer's decision: focus that looks like hover

`.context-menu-item:is(:hover, :focus-visible)` gives both the same fill and removes the outline. The drift report's two families disagree on it:

- **Keep it** (cms:B3): a fill is the usual way to mark the current item in a roving menu, and a ring inside a 10rem popover is heavy. The rest of the menu is already one component and needs nothing.
- **Change it** (btn:B8): with the pointer resting on one item and the arrow keys on another, two items are lit, and nothing says which one Enter will choose. That's the specimen above. The fix is to keep the fill for hover and give `:focus-visible` an inset ring (`outline-offset` of minus `--border-thick`), as `.cluster-toggle` already does.

Until it's decided, copy the menu as it is: don't give a new menu its own focus rule.

## Keyboard and ARIA

- **Open:** right-click on the row opens it at the pointer. With focus on the row (or anything in the wrapper), the Menu key or Shift+F10 opens it under the focused element. Focus moves to the first item.
- **Move:** ↑ and ↓ move and wrap around; with nothing focused, ↓ goes to the first item and ↑ to the last. Home and End jump to the ends.
- **Choose:** Enter or Space on an item, or a click. The menu closes, focus goes back to the row, then the item does its work.
- **Close:** Escape or Tab closes it and gives focus back. Both stop there, so Escape doesn't also close the drawer behind it. A click outside closes it too (`popover="auto"`).
- `role="menu"` with `aria-label` "Actions for {title}"; items are `role="menuitem"` with `tabindex="-1"`, reached by the arrow keys, not Tab.
- **Swipe:** the actions are `aria-hidden` and out of the tab order until revealed; then each revealed one is `tabindex="0"`. Escape on an open row closes it. A tap on an open row closes it rather than following the link. A rightward swipe on a closed row is left to the browser, whose back gesture it is.
- The row itself gives no sign that it has a menu. Neither `aria-haspopup` nor a visible "⋯" exists; a visible trigger is a separate product decision (cms:B3).

## Content

- The menu's label: "Actions for {title}", the thread's title or "New thread", or the workstream's name.
- Items are verbs in sentence case: **Mark done**, **Reopen**, **Delete…**. An item that asks a question first ends in "…".
- The swipe's actions are the same words, in the same order.
- Keep it to the actions that end or reopen a thing. Anything else belongs on its page.

## Where the app uses it

- `ContextMenu` in `packages/web/src/menu.tsx`. CSS for the menu, its items, their hover and focus, and the danger item: `.context-menu`, `.context-menu-item`, `.context-menu-item:is(:hover, :focus-visible)` and `.context-menu-item[data-danger]` in `window.css`.
- `ThreadMenu` in `packages/web/src/close-thread.tsx`, used by `NeedsYou`, `WorkstreamEntry` and `Done` in `packages/web/src/sidebar.tsx` (each with the swipe) and by `Threads` in `packages/web/src/workstream-page.tsx`.
- `WorkstreamMenu` in `packages/web/src/end-workstream.tsx`, used by `WorkstreamEntry` in `packages/web/src/sidebar.tsx` (with the swipe) and by `DonePage` in `packages/web/src/other-pages.tsx`.
- `Swipeable` in `packages/web/src/swipe.tsx`, which draws its actions too; the stops in `packages/web/src/swiping.ts`. CSS: `.swipe`, `.swipe-row`, `.swipe-actions`, `.swipe-action` and `.swipe-action[data-danger]` in `window.css`.

The menu is one component used everywhere it shows, so its status is stable. Two small things drift with other pages: the focus look above (btn:B8), and the tooltip's `--radius-sm` against the menu's `--radius-lg` for the two top-layer surfaces (cms:B3). See [the drift report](/drift).
