---
title: Drag to move
order: 61
summary: An item's row dragged onto a workstream in the sidebar moves it there; onto the Workstreams heading, a menu offers a new workstream. A row's menu does the same from the keyboard.
---

# Drag to move

## The problem

A person reading a workstream sees an item that belongs in another. Removing it here, then finding it in Browse and adding it there, is two trips for one move. The sidebar already lists every open workstream, beside the page, so the row can go straight there.

## The pattern

On a workstream's page each item's row drags (`Member` in `packages/web/src/parts.tsx`, with `dragItem` from `packages/web/src/drag-item.ts`). So does a Browse row, which came from no workstream, so it only joins. The cursor is a grab over the row and says move during the drag.

The item rides on a card while it's dragged, in place of the browser's picture of its row (`lift` in `packages/web/src/drag-card.ts`): its key and title, raised on `--shadow`, the pointer at its left edge (`.drag-card`, `.drag-card-face` and `.drag-card-title` in `window.css`). It leans a couple of degrees the way it's pulled, 3° at most and never past 4°, and eases back to level when the pointer stops, like a card held at one corner. The row it came from dims while it's away (`[data-lifted]`). Dropped, the card is set down where the pointer let go: it comes level, shrinks a touch and fades. Dropped nowhere, it slides back to its row and fades there, and the row comes back. See [Motion](/foundations/motion#drag).

```html specimen id=card title="The card, mid-drag, leaning the way it's pulled" height=110 bg=surface
<div style="position: relative; height: 80px">
  <div
    class="drag-card"
    style="position: absolute; transform: translate3d(40px, 40px, 0) rotate(2.5deg)"
  >
    <div class="drag-card-face">
      <span class="key">SYN-23</span
      ><span class="drag-card-title">Pay with a phone wallet on the website</span>
    </div>
  </div>
</div>
```

Each open workstream in the sidebar takes the drop (`useItemDrop` in `packages/web/src/drag-item.ts`). While an item is over one, its row is drawn as the [drop veil](/patterns/drop-zone) is: `--accent-soft`, with a `--border-thick` `--accent` ring inside, on `--radius`. The workstream the item came from takes nothing: the cursor says no, and a drop there does nothing. A drop anywhere else cancels.

```html specimen id=over title="An item over a workstream in the sidebar" bg=surface
<ul class="nav-workstreams">
  <li>
    <div class="nav-workstream-row" data-drop-over>
      <span class="nav-disclose" aria-hidden="true"></span>
      <div class="nav-workstream-menu">
        <a href="/workstreams/gift-cards" class="nav-link">
          <span class="nav-name">Gift cards</span>
          <span class="nav-count" title="1 item">1</span>
        </a>
      </div>
    </div>
  </li>
  <li>
    <div class="nav-workstream-row">
      <span class="nav-disclose" aria-hidden="true"></span>
      <div class="nav-workstream-menu">
        <a href="/workstreams/checkout" class="nav-link" aria-current="page">
          <span class="nav-name">Checkout polish</span>
          <span class="nav-count" title="3 items">3</span>
        </a>
      </div>
    </div>
  </li>
</ul>
```

Dropped on the Workstreams heading, which is drawn the same way while the item is over it, a [context menu](/components/menu) opens where the pointer let go: Create new workstream, and Cancel. Create makes a workstream of the item, named as picking it alone in Browse names one (its title), and opens it, where its name can be changed. Cancel, Escape or a click outside does nothing.

```html specimen id=heading-menu title="Dropped on the Workstreams heading" height=200 bg=surface
<div class="fold-head" data-drop-over>
  <h2 class="rail-title">
    <button type="button" class="fold-toggle" aria-expanded="true" aria-controls="nav-workstreams">
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      Workstreams
    </button>
  </h2>
</div>
<div
  popover="manual"
  data-ws-open
  role="menu"
  aria-label="Move SYN-23"
  class="context-menu"
  style="left: 120px; top: 40px"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">
    Create new workstream
  </button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Cancel</button>
</div>
```

A move is Oriel's two actions on workstreams, in turn: the item joins where it goes, then leaves where it came from, so the change log, the region-version marker and telemetry hear it as any add and removal (`packages/web/src/moving.ts`). It shows as one note in the [bead](/components/bead): "Moved {key} from “{from}” to “{to}”.", "Added {key} to “{to}”." from Browse, or "Moved {key} to a new workstream, “{name}”.", whose Undo sends back both calls.

The keyboard, and a phone where the sidebar is a drawer, move it with the row's own menu: right-click, Shift+F10 or the Menu key on the row, then Move to “{name}” or Move to a new workstream.

## Do

- Draw the target only while it takes the drop, and only under the pointer.
- Say what moved, from where and to where, in the note, with Undo.
- Offer the same moves in the row's menu.
- Let the card lean only with the pull, and set it down level.

## Don't

- Don't take a drop on the workstream the item came from.
- Don't ask before a move onto a workstream. Undo is the answer to a wrong drop.
- Don't offer a done workstream: the sidebar lists only open ones.

## Where Oriel does it

- The drag and the drop targets: `dragItem` and `useItemDrop` in `packages/web/src/drag-item.ts`.
- The card and its lean: `lift`, `drop` and `leanStep` in `packages/web/src/drag-card.ts`. The browser's own picture is set to an empty `.drag-blank`, since the page's policy loads no `data:` image.
- The move, its note and its Undo: `updateMoving`, `movingReplied` and `movingUndos` in `packages/web/src/moving.ts`.
- The targets: `Workstreams` and `WorkstreamEntry` in `packages/web/src/sidebar.tsx`. The menu at the drop: `Menu` in `packages/web/src/menu.tsx`.
- The row's menu: `movingOf` in `packages/web/src/workstream-page.tsx`.
- CSS: `.member-menu`, and `[data-drop-over]` on `.nav-workstream-row` and `.fold-head`, in `window.css`.
