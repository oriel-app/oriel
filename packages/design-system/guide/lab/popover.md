---
title: Popover, menu and tooltip
status: proposed
order: 50
summary: Oriel's menus and tooltips are popovers that JS measures and places. CSS anchor positioning places them instead, flips them at an edge, and fades them in; interestfor and popover=hint can open a tooltip without JS in the desktop app. The context menu at the pointer stays JS.
classes: popover-menu, popover-tip, context-menu, context-menu-item, tooltip, head-action, panel-close
---

# Popover, menu and tooltip

## What it is

Two things in Oriel float in the top layer, above every scroll and slide:

- **The context menu** (`ContextMenu` in `packages/web/src/menu.tsx`): a thread's or a workstream's actions, "Mark done" (or "Reopen") and "Delete…". A right-click opens it at the pointer; Shift+F10 or the Menu key opens it under the focused row. It's `popover="auto"`.
- **The tooltip** (`Tooltip` in `packages/web/src/tooltip.tsx`): a few words on an icon button, such as "Close (Esc)" or "Delete…". It's `popover="manual"`, shown by JS a moment after the pointer rests, or at once on keyboard focus.

Both are placed by JS: the menu clamps the pointer's point inside the window (`ContextMenu` in `packages/web/src/menu.tsx`), and the tooltip measures its control and itself and picks above or below (`wire` in `packages/web/src/tooltip.tsx`, with the maths in `placeTooltip` in `packages/web/src/tooltips.ts`).

The proposal hands the placing to CSS, where there's an element to anchor to:

- **CSS anchor positioning** places a popover against its control (`anchor-name`, `position-anchor`, `position-area`) and flips it at an edge (`position-try-fallbacks: flip-block`).
- **Invokers** open it with no click handler: `popovertarget`, or `command="toggle-popover"` with `commandfor`.
- **`popover="hint"`** makes a tooltip a popover that doesn't close an open menu.
- **`interestfor`** opens a tooltip on hover and on focus with no JS, in Chromium only.
- **`@starting-style`** fades each in.

Oriel has **no menu opened by a button** today; the menus are context menus, and the same actions are a workstream header's icon buttons (`EndButtons` in `packages/web/src/end-workstream.tsx`) and a row's swipe. The menu button below shows what anchor positioning does best; it isn't a request for one.

## Today

Right-click the row, or focus it and press Shift+F10. Hover or Tab to the icon buttons for their tooltips. These run `assets/frame.js`'s copies of menu.tsx and tooltip.tsx.

```html specimen id=today-menu title="Context menu: right-click or Shift+F10 (JS places it at the pointer)" side=today height=200
<ul class="nav-waiting">
  <li>
    <a class="nav-link nav-waiting-link" href="#" data-ws-menu="today-thread-menu">
      <span class="state-dot" data-state="open" data-waiting="review"></span>
      <span class="nav-waiting-text">
        <span class="nav-name">Pay with a phone wallet on the website</span>
        <span class="nav-waiting-about">
          <span class="nav-waiting-on" data-waiting="review">Needs review</span>
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </span>
      </span>
    </a>
  </li>
</ul>
<div
  id="today-thread-menu"
  popover="auto"
  role="menu"
  aria-label="Actions for Pay with a phone wallet on the website"
  class="context-menu"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=proposed-context-menu title="Context menu, proposed: still JS at the pointer, now fading in" side=proposed height=200
<ul class="nav-waiting">
  <li>
    <a class="nav-link nav-waiting-link" href="#" data-ws-menu="proposed-thread-menu">
      <span class="state-dot" data-state="open" data-waiting="review"></span>
      <span class="nav-waiting-text">
        <span class="nav-name">Pay with a phone wallet on the website</span>
        <span class="nav-waiting-about">
          <span class="nav-waiting-on" data-waiting="review">Needs review</span>
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </span>
      </span>
    </a>
  </li>
</ul>
<div
  id="proposed-thread-menu"
  popover="auto"
  role="menu"
  aria-label="Actions for Pay with a phone wallet on the website"
  class="context-menu popover-menu"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=today-tips title="Tooltips: JS shows them on hover and focus, and measures where they go" side=today height=110
<div class="workstream-actions">
  <button
    type="button"
    class="head-action"
    aria-label="Mark done: Checkout v2: phone wallets and saved cards"
    aria-describedby="today-tip-done"
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
    </svg>
  </button>
  <span id="today-tip-done" role="tooltip" popover="manual" class="tooltip">Mark done</span>
  <button
    type="button"
    class="head-action"
    data-danger
    aria-label="Delete Checkout v2: phone wallets and saved cards…"
    aria-describedby="today-tip-delete"
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
      />
    </svg>
  </button>
  <span id="today-tip-delete" role="tooltip" popover="manual" class="tooltip">Delete…</span>
</div>
```

```html specimen id=proposed-tips title="Tooltips, proposed: interestfor opens them, CSS places them (no JS in Chromium)" side=proposed height=110
<div class="workstream-actions">
  <button
    type="button"
    class="head-action"
    aria-label="Mark done: Checkout v2: phone wallets and saved cards"
    aria-describedby="proposed-tip-done"
    interestfor="proposed-tip-done"
    style="anchor-name: --proposed-tip-done"
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
    </svg>
  </button>
  <span
    id="proposed-tip-done"
    role="tooltip"
    popover="hint"
    class="tooltip popover-tip"
    style="position-anchor: --proposed-tip-done"
    data-ws-anchored
    >Mark done</span
  >
  <button
    type="button"
    class="head-action"
    data-danger
    aria-label="Delete Checkout v2: phone wallets and saved cards…"
    aria-describedby="proposed-tip-delete"
    interestfor="proposed-tip-delete"
    style="anchor-name: --proposed-tip-delete"
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
      />
    </svg>
  </button>
  <span
    id="proposed-tip-delete"
    role="tooltip"
    popover="hint"
    class="tooltip popover-tip"
    style="position-anchor: --proposed-tip-delete"
    data-ws-anchored
    >Delete…</span
  >
</div>
```

## Proposed

`assets/proposals/popover.css`. Two classes, added beside window.css's own (`.context-menu`, `.tooltip`), which keep the look:

- **`.popover-menu`**: under its button, 4px off, with their start edges lined up (`top: calc(anchor(bottom) + var(--space-1))`, `left: anchor(left)`); above it when there's no room below (`flip-block`), and the other way along when there's none across (`flip-inline`). It uses `anchor()` insets, not `position-area` and a margin, because a context menu has no anchor and its JS-written point mustn't move.
- **`.popover-tip`**: centred above its control (`position-area: block-start`), 6px off and kept 8px inside the window's sides, as `placeTooltip` does; below it when there's no room above (`flip-block`).
- **Both** fade in over `--duration-quick` from `@starting-style` (the menu also drops 4px), go at once as today, hold still under reduced motion, and have no `::backdrop`: a menu or a tooltip never dims the page; only the confirm does (`.confirm::backdrop` in `window.css`).

**Naming the anchor.** Each control gets `anchor-name: --<id>` and its popover `position-anchor: --<id>`, written inline, as Preact would from the `useId()` the tooltip already has. Chromium 156 finds the anchor by itself when `popovertarget`, `commandfor` or `interestfor` opened the popover (tested here: with no names, the menu and tooltip still land in place), but Safari and Firefox differ on that implicit anchor, so name it.

**The context menu stays JS.** Anchor positioning anchors to an element, and a right-click's point isn't one. Faking one (a 0×0 element JS moves to the pointer) would still be JS, to save the four lines that clamp it today. So the context menu keeps `menu.tsx`'s placing, and gains only the fade. Its keyboard open, under the focused row, could anchor to that row; it's not worth a second path.

### A menu opened by a button

`popovertarget` opens and closes it, with no click handler, and Chromium tells a screen reader whether it's expanded. Escape and a click outside close it, and focus goes back to the button. What JS still does is the menu's keys, as menu.tsx does them.

```html specimen id=proposed-menu-button title="A menu button: popovertarget opens it, CSS places it (try Enter, ↓ and ↑)" side=proposed height=170
<div class="workstream-actions">
  <button
    type="button"
    class="button"
    popovertarget="actions-menu"
    aria-haspopup="menu"
    style="anchor-name: --actions-menu"
  >
    Actions
  </button>
</div>
<div
  id="actions-menu"
  popover="auto"
  role="menu"
  aria-label="Actions for Checkout v2: phone wallets and saved cards"
  class="context-menu popover-menu"
  style="position-anchor: --actions-menu"
  data-ws-anchored
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

## States

Shown open (`data-ws-open`). Today's are placed the way the app's JS places them; the proposed ones only by CSS.

```html specimen id=today-menu-open title="Menu open today: at the pointer's point, clamped inside the window" side=today height=150
<ul class="nav-waiting">
  <li>
    <a class="nav-link nav-waiting-link" href="#">
      <span class="state-dot" data-state="open" data-waiting="review"></span>
      <span class="nav-waiting-text">
        <span class="nav-name">Pay with a phone wallet on the website</span>
        <span class="nav-waiting-about">
          <span class="nav-waiting-on" data-waiting="review">Needs review</span>
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </span>
      </span>
    </a>
  </li>
</ul>
<div
  popover="manual"
  data-ws-open
  role="menu"
  aria-label="Actions for Pay with a phone wallet on the website"
  class="context-menu"
  style="left: 120px; top: 40px"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=proposed-menu-open title="Menu open, proposed: under its button, by CSS" side=proposed height=150
<div class="workstream-actions">
  <button
    type="button"
    class="button"
    aria-haspopup="menu"
    aria-expanded="true"
    style="anchor-name: --open-menu"
  >
    Actions
  </button>
</div>
<div
  popover="manual"
  data-ws-open
  data-ws-anchored
  role="menu"
  aria-label="Actions for Checkout v2: phone wallets and saved cards"
  class="context-menu popover-menu"
  style="position-anchor: --open-menu"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=today-menu-edge title="Near the bottom today: clamped up, over its own row" side=today height=150
<div class="ws-note">A right-click near the window's foot.</div>
<div style="height: 64px"></div>
<a class="nav-link nav-waiting-link" href="#">
  <span class="nav-waiting-text"><span class="nav-name">Gift cards</span></span>
</a>
<div
  popover="manual"
  data-ws-open
  role="menu"
  aria-label="Actions for Gift cards"
  class="context-menu"
  style="left: 60px; top: 76px"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=proposed-menu-edge title="Near the bottom, proposed: flip-block puts it above its button (command and commandfor)" side=proposed height=150
<div class="ws-note">A menu button near the window's foot.</div>
<div style="height: 64px"></div>
<button
  type="button"
  class="button"
  command="toggle-popover"
  commandfor="edge-menu"
  aria-haspopup="menu"
  style="anchor-name: --edge-menu"
>
  Actions
</button>
<div
  id="edge-menu"
  popover="manual"
  data-ws-open
  data-ws-anchored
  role="menu"
  aria-label="Actions for Gift cards"
  class="context-menu popover-menu"
  style="position-anchor: --edge-menu"
>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item">Mark done</button>
  <button type="button" role="menuitem" tabindex="-1" class="context-menu-item" data-danger>
    Delete…
  </button>
</div>
```

```html specimen id=today-tip-top title="Tooltip at the window's top today: no room above, so JS puts it below" side=today height=90 pad=0
<div class="workstream-actions">
  <button
    type="button"
    class="panel-close"
    aria-label="Close the panel"
    aria-describedby="today-tip-close"
  >
    ×
  </button>
  <span id="today-tip-close" role="tooltip" popover="manual" data-ws-open class="tooltip"
    >Close (Esc)</span
  >
</div>
```

```html specimen id=proposed-tip-top title="At the top, proposed: flip-block puts it below, with no JS" side=proposed height=90 pad=0
<div class="workstream-actions">
  <button
    type="button"
    class="panel-close"
    aria-label="Close the panel"
    aria-describedby="proposed-tip-close"
    style="anchor-name: --tip-close"
  >
    ×
  </button>
  <span
    id="proposed-tip-close"
    role="tooltip"
    popover="hint"
    data-ws-open
    data-ws-anchored
    class="tooltip popover-tip"
    style="position-anchor: --tip-close"
    >Close (Esc)</span
  >
</div>
```

```html specimen id=today-tip-room title="With room today: above, centred" side=today height=110
<div style="height: 40px"></div>
<div class="workstream-actions">
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
  <span role="tooltip" popover="manual" data-ws-open class="tooltip">Delete…</span>
</div>
```

```html specimen id=proposed-tip-room title="With room, proposed: above, centred, by CSS" side=proposed height=110
<div style="height: 40px"></div>
<div class="workstream-actions">
  <button
    type="button"
    class="head-action"
    data-danger
    aria-label="Delete Checkout v2: phone wallets and saved cards…"
    style="anchor-name: --tip-room"
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
      />
    </svg>
  </button>
  <span
    role="tooltip"
    popover="hint"
    data-ws-open
    data-ws-anchored
    class="tooltip popover-tip"
    style="position-anchor: --tip-room"
    >Delete…</span
  >
</div>
```

- **Closed, open:** both. Open is `:popover-open`.
- **Placement at an edge:** today's JS clamps the menu inside the window, which can cover the row it's for; the proposed menu flips above its button instead. The tooltip flips below in both, and the proposed one does it without measuring.
- **Entering:** today a menu and a tooltip appear at once. Proposed, they fade in over `--duration-quick` (the menu also drops 4px). Leaving is at once in both. Reduced motion holds both still.
- **Hover and focus on an item:** in both, `.context-menu-item:is(:hover, :focus-visible)` in `window.css`; the danger item tints `--danger-soft`.
- **Disabled item, separator, checked item:** not in Oriel, and not proposed.
- **Busy, error, empty:** don't apply. A menu with no items doesn't open (`ContextMenu` in `packages/web/src/menu.tsx`).

## Keyboard and ARIA

What changes is who does it, not what it does.

|                               | Today (menu.tsx, tooltip.tsx)                            | Proposed                                                                                                                   |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Open a context menu           | Right-click, Shift+F10, Menu key: JS                     | The same JS                                                                                                                |
| Open a menu button            | (no menu button)                                         | Enter or Space: `popovertarget`, native. ↓ or ↑: JS, to the first or last item                                             |
| Focus on open                 | The first item: JS                                       | The first item: JS, on the popover's `toggle` event                                                                        |
| ↑ ↓ Home End                  | JS, wrapping                                             | The same JS                                                                                                                |
| Escape                        | JS closes, refocuses, stops the key there                | Native: an `auto` popover closes on Escape and gives focus back to its invoker                                             |
| Tab                           | JS closes and refocuses                                  | The same JS                                                                                                                |
| Click outside                 | Native (`popover="auto"`)                                | Native                                                                                                                     |
| `aria-expanded` on the button | n/a                                                      | Native with `popovertarget` and `commandfor` in Chromium; set it by hand for others                                        |
| Tooltip on hover              | After 400ms: JS                                          | `interestfor`, after Chromium's delay (`interest-delay-start`, 0.5s by default)                                            |
| Tooltip on keyboard focus     | **At once**: JS, only on `:focus-visible`                | `interestfor`, **after the same delay**: a change                                                                          |
| Tooltip on touch              | Nothing                                                  | A long press shows it: a change                                                                                            |
| Tooltip and Escape            | JS hides it, and the key still does its other job        | A `hint` closes on Escape natively                                                                                         |
| Tooltip's description         | `aria-describedby`, set by JS unless it repeats the name | Keep `aria-describedby` in the markup: `interestfor` alone didn't describe the button in Chromium 156's accessibility tree |

- The menu keeps `role="menu"`, its `aria-label` ("Actions for …") and `role="menuitem" tabindex="-1"` items. A menu button adds `aria-haspopup="menu"`.
- Escape inside a context menu today also stops the key reaching the drawer (`ContextMenu` in `packages/web/src/menu.tsx`). A native close doesn't stop it, so a menu inside the drawer keeps its Escape handler.

## Support and fallback

| Feature                                      | Chromium                                                 | Desktop (Chromium 156) | Safari / Firefox           | Fallback                                                                                           |
| -------------------------------------------- | -------------------------------------------------------- | ---------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| Popover API (today), `popovertarget`         | 114                                                      | Yes                    | Safari 17, Firefox 125     | n/a                                                                                                |
| `anchor-name`, `position-anchor`, `anchor()` | 125                                                      | Yes                    | Safari 26, Firefox 147     | Inside `@supports (anchor-name: --a)`; without it, JS places it, as today                          |
| `position-area`                              | 129                                                      | Yes                    | Safari 26, Firefox 147     | The same                                                                                           |
| `position-try-fallbacks: flip-block`         | 128                                                      | Yes                    | Safari 26, Firefox 147     | The same                                                                                           |
| Implicit anchor from the invoker             | Yes (with `position-anchor` initially `normal` from 151) | Yes                    | Differs                    | Name the anchor explicitly, as here                                                                |
| `command`, `commandfor`                      | 135                                                      | Yes                    | Safari 26.2, Firefox 144   | `popovertarget`, or `onClick` → `togglePopover()`                                                  |
| `popover="hint"`                             | 133                                                      | Yes                    | Firefox 149; **Safari no** | Safari treats it as `manual`, today's value; it only can't sit open beside a menu                  |
| `interestfor`                                | 142                                                      | Yes                    | **Neither**                | Today's JS show and hide, kept for pages Safari or Firefox open (`assets/frame.js` does this here) |
| `@starting-style` (entry)                    | 117                                                      | Yes                    | Safari 17.5, Firefox 129   | It just appears                                                                                    |
| `::backdrop` on a popover                    | 114                                                      | Yes                    | Yes                        | n/a                                                                                                |

Tested here in headless Chrome 156 (playwright): the menu button opens the menu under it by Enter, ↓ and ↑, focus lands on the first (or last) item, the arrows wrap, Escape closes it and focus returns to Actions; the bottom menu sits above its button; the top tooltip sits below its control and the roomy one above, centred; `interestfor` opens the tooltip on hover and on keyboard focus after its delay. Safari and Firefox weren't run: no matching engine was installed. The review link's page has no menu or tooltip.

## Adopt now or wait

- **Anchor positioning for tooltips: adopt now.** Every engine Oriel meets has had it since January 2026, the tooltip has an element to anchor to, and `placeTooltip` and its measuring go. Keep the JS placement behind `CSS.supports("anchor-name: --a")` for one release, then delete it.
- **`popover="hint"` for tooltips: adopt now.** In Safari it's `manual`, which is today.
- **`interestfor`: wait.** It changes two behaviours Oriel chose on purpose (at once on keyboard focus, nothing on touch), and Safari and Firefox lack it, so the JS stays anyway. Revisit when Safari ships it and if its delay can be zero on focus.
- **The entry fade: adopt now** for both, as a polish; it costs nothing where unsupported.
- **The context menu: keep JS.** Anchor positioning can't place at a point. Take only the fade.
- **A menu button: only when Oriel needs one.** If it does, build it this way: `popovertarget` (or `commandfor`) and `.popover-menu`, with menu.tsx's keys.

## How to migrate

1. Paste `assets/proposals/popover.css` after `.tooltip` in `window.css`, as rules on `.tooltip` and `.context-menu` themselves (drop the extra classes). `.tooltip`'s `position: fixed` and `inset: auto` stay.
2. In `Tooltip` in `packages/web/src/tooltip.tsx`: `popover="hint"` and a `style` whose `positionAnchor` is `--` and the tip's id; set the control's `style.anchorName` to the same in its layout effect. `useId()` gives ids such as `P0-3`, which make a valid `--P0-3`.
3. In `show`, inside `wire` in `packages/web/src/tooltip.tsx`, wrap the measuring in `if (!CSS.supports("anchor-name: --a"))`. Then delete it, and `placeTooltip` in `packages/web/src/tooltips.ts` with its test, once the fallback is no longer wanted. Keep `data-side` only if something reads it; nothing in window.css does.
4. `ContextMenu` in `packages/web/src/menu.tsx` keeps its placing. It gets the fade from step 1.
5. Rerun `pnpm shots` for the item panel's header (its tooltips sit near the top), the sidebar with a menu open, and a workstream's header, in both themes and both schemes.
