---
surveyed: 85a125e9
---

# Custom form controls in modern CSS

What Oriel could draw with today's CSS instead of today's JavaScript and system controls, tested in the engines Oriel runs in, with a plain verdict for each. Every proposal is a working specimen in the [controls lab](/lab/select), beside what Oriel ships, in every state and both themes; its CSS is in `assets/proposals/`, written only with Oriel's tokens and judged by Oriel's own literal rule in `pnpm check`.

**A dated snapshot.** Tested on 2026-11-04 at Oriel `5ee7a339`; re-surveyed on 2026-11-05 at `85a125e9`, on `main`, with no browser re-run: the engines are the same. Every `file:line` here is `85a125e9`'s: a line link opens the file as it was then, and `pnpm check` doesn't check them, so a stale line never fails the build. A story built from this re-reads `main` before it starts, and `pnpm -s ds where <name>` prints where a selector or symbol is today.

## Which browsers Oriel must support

- **The desktop app: Chromium 156.** It runs Electron 45.0.0, pinned at `packages/desktop/src/electron.ts:8` and vendored from the release zip, not npm. Electron 45.0.0 ships Chromium 156.0.8078.48; the built app's framework carries the same string. A new Electron must be 7 days old to pin, so the desktop engine trails Chrome stable by weeks, not versions.
- **The web app in development and its tooling: Chrome 156.** `pnpm shots` and `pnpm perf` drive the installed Chrome (`scripts/shots.ts`, `channel: "chrome"`); this Mac has 156.0.8078.80.
- **The review link page: any browser.** Decisions 0001, 0029 and 0036 say a review link must open for someone who has installed nothing, and links leave the desktop shell for the person's default browser. `ReviewPage` (`packages/web/src/other-pages.tsx:183`) loads the same `window.css`. So **every rule the review page reaches must degrade in current Safari and Firefox**. It has a text field, a textarea and buttons; no select, menu, tooltip, switch or checkbox.

So: inside the window, anything shipped in Chromium 156 is fair. On shared selectors, a feature that changes behaviour where it's missing (`if()`, `interestfor`, `<dialog closedby>`) must stay off, or behind `@supports`. A feature that only loses polish where it's missing is fine.

No Safari run was possible here (the cached WebKit build doesn't speak this playwright-core's protocol), and Firefox was checked by screenshot only, on Firefox 142. Cross-engine claims come from MDN, the web-features data and the engines' release notes, cited in the lab pages.

## Verdicts

| Control or feature                                                   | Verdict                  | In one line                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [Customizable select](/lab/select) (`appearance: base-select`)       | **Adopt now**            | Oriel's own picker in every theme, rich options, native keyboard; falls back to a native select styled like Oriel's            |
| [`field-sizing: content`](/lab/text-field#growing-textareas)         | **Adopt now**            | Already on the composer; replace the JS row count on the held message, and use it on the review reason                         |
| [`:user-invalid`](/lab/text-field)                                   | **Adopt now**            | Red only after the person has typed and left; beside `[aria-invalid]`                                                          |
| [One field frame focus](/lab/text-field)                             | **Adopt now**            | The same border-and-ring for every field (drift D4)                                                                            |
| [SearchField](/lab/text-field#search)                                | **Adopt now**            | One class for two identical searches (drift D5)                                                                                |
| [Anchor positioning for tooltips](/lab/popover)                      | **Adopt now**            | Same pixels as today's JS, behind `@supports`; delete `placeTooltip` a release later                                           |
| [`popover="hint"`](/lab/popover) for tooltips                        | **Adopt now**            | Safari treats it as `manual`, which is today                                                                                   |
| [Entry fade with `@starting-style`](/lab/popover)                    | **Adopt now**            | Menus, tooltips and the confirm fade in over `--duration-quick`                                                                |
| [Switch redraw, and a real locked state](/lab/switch)                | **Adopt now**            | Keep `button[role=switch]`; fix the weak off state and the vanishing switch in forced colours                                  |
| [`accent-color` on the connect steps' radios](/lab/checkbox-radio)   | **Done**                 | #173 set it on `html`, so every checkbox, radio and range takes the accent                                                     |
| [`text-wrap: balance`](/lab/more) on titles, `pretty` on prose       | **Adopt now**            | Small, safe, Firefox ignores `pretty`                                                                                          |
| [`scrollbar-gutter: stable`](/lab/more)                              | **Adopt now**            | Sidebar, rail, item panel, window chat: no shift when a list grows a scrollbar                                                 |
| [`interpolate-size` and `::details-content`](/lab/more)              | **Adopt now, as polish** | A run line opens smoothly in the desktop app; snaps elsewhere, as today                                                        |
| [Drawn checkbox and radio](/lab/checkbox-radio) (`appearance: none`) | **Wait**                 | Works, follows text size, clears 3:1; but `accent-color` already gives the accent, for ~90 fewer lines                         |
| [`interestfor`](/lab/popover) for tooltips                           | **Wait**                 | Delays keyboard focus by ~0.5s, shows on touch, gives no description; no Safari or Firefox                                     |
| [`<input type=checkbox switch>`](/lab/switch)                        | **Wait**                 | Not in Chromium 156                                                                                                            |
| [Menu button by `popovertarget`](/lab/popover)                       | **When needed**          | Oriel has no menu button today; build it this way when it does                                                                 |
| [Context menu at the pointer](/lab/popover)                          | **Keep the JS**          | Anchor positioning can't anchor to a point                                                                                     |
| [`light-dark()`](/lab/more)                                          | **Doesn't apply**        | It follows `color-scheme`, not Oriel's theme blocks: tested, it took the light branch in Broadsheet dark                       |
| [`@scope`, `@layer`](/lab/more)                                      | **Not needed**           | One stylesheet with class prefixes already scopes                                                                              |
| [Nesting](/lab/more)                                                 | **Wait**                 | Oriel's CSS reader (`packages/web/themes.ts`) loses a nested rule's parent; the theme check and this workshop key on selectors |
| `color-mix()`, `:has()`, container size queries                      | **Keep using**           | Already in window.css: 47, 9 and 3 uses                                                                                        |
| `sibling-index()`, container style queries                           | **When needed**          | Baseline in 2026; no use in Oriel yet                                                                                          |

## Select first

The customizable select is the one most worth doing. Today Oriel has four native selects, each styled on its own (a pivot block's picks, from chart blocks, are the fourth), and the list that opens is the operating system's: its font, its colours, its corners, whatever the theme.

The proposal (`assets/proposals/select.css`, class `.dropdown`) has two layers:

- **Every engine:** a native select that looks like Oriel's fields: one border, one radius, one height, the field focus.
- **Inside `@supports (appearance: base-select)`:** the select and its `::picker(select)` are Oriel's own. The list is drawn like the context menu, in the theme; options can carry a state dot, a count or a line about the choice; `<selectedcontent>` shows the chosen option's dot and name in the button; `option::checkmark` ticks the chosen one in the accent; `:open` styles the open state.

What was tested, in Chrome 156: clicking or Space opens Oriel's list; Down and Enter pick; Escape closes without picking; type-ahead works; `<selectedcontent>` copies the option's dot and name and the CSS hides its count and description. Listbox mode (`size`) takes the same option rules, which the lab uses to show every option state in place. Firefox 142 gets layer one: a native select with Oriel's border, radius and focus.

Three traps, each written up in the lab:

- A `label=` attribute on a rich option shows only the label in the open list.
- A base-select sizes to the chosen option, not the widest, so a filter changes width when set. Give filters a min-width.
- In the fallback, a rich option's text runs together ("Opus 5.5 · Claude Code The largest…"), so the markup keeps a space before each description, and descriptions read after the name.

Keyboard is the native select's: Space or Alt+↓ opens (Enter doesn't, on macOS), arrows move, letters jump, Escape closes. Typing on a closed "Add to…" picks and adds at once, as it does today. **Decided 2026-11-05** (no story): "Add to…" stays a select, and takes the customizable select with the others.

Migration: `packages/web/src/window-page.tsx:126` (filters), `packages/web/src/window-page.tsx:620` ("Add to…"), `packages/web/src/settings-page.tsx:424` (models) and `packages/web/src/charts.tsx:377` (a pivot's picks) take `class="dropdown"`; their four CSS blocks go (`window.css:1700`, `window.css:2255`, `window.css:6346`, `window.css:3279`), and `:has(option[value=""]:checked)` replaces the JS-set `data-set`. No select is on the review link page.

## Text fields

- `field-sizing: content` grows a textarea from 2 to 8 lines and then scrolls (measured: 49.7px empty, 162.75px capped). It replaces the JS row count on a held message (`packages/web/src/thread-page.tsx:537`), which today doesn't grow while the person types. Where it's missing (Firefox 142), `rows` and the resize handle hold, so the review page's reason field is safe.
- `:user-invalid` turns a field's border red only after the person has typed and left it: tested false on arrival, false while typing, true after Tab. It sits beside `[aria-invalid]`, which Oriel already sets when a connector names a field.
- The proposed `Field` ties its hint and its problem to the input with `aria-describedby`. Nothing in Oriel does today.
- One focus, the frame's border and a 1px ring in `--focus`, the same as [ChatInput](/components/chat-input) and the sidebar's search.

## Checkbox and radio

`accent-color` already makes a checked box "your choice made" in every engine, and none of these controls is on the review page. The drawn version (`appearance: none` on the real input, so keyboard and names stay native) works and is better in measurable ways: it follows the text size (16px, 18px at Large, where the browser's stays 13px), its edge clears 3:1 in every theme, and it looks the same in every engine. It costs about 90 lines and a forced-colours fallback. **Wait.** The one gap, the connect steps' radios in the browser's blue, is closed: #173 set `accent-color` on `html` (`window.css:294`).

Oriel doesn't use the indeterminate state, and shouldn't on Browse's anchor pick: that box picks the epic as an item, not its items.

## Switch

Keep the `button[role=switch]`: it flips on Enter and Space, where a checkbox with `role="switch"` loses Enter; and `<input switch>` isn't in Chromium. But redraw it now:

- Today's off track is `--line-strong` on the surface, 1.8 to 2.4:1, and in dark schemes the knob is `--on-accent`, dark on a dark track.
- In forced colours (emulated), today's switch vanishes; only its focus ring shows. The proposal keeps its edge and draws the knob as a ring.
- A locked switch (a spreadsheet the person can only view) is `disabled` today, so Tab skips it and a screen reader never hears why. The proposal uses `aria-disabled` with `aria-describedby` to the reason: tested focusable, announced as disabled with its reason, and a click doesn't flip it.

## Menus and tooltips

Both are already popovers in the top layer (`packages/web/src/menu.tsx:94`, `packages/web/src/tooltip.tsx:48`), placed with `getBoundingClientRect` in JS. With anchor positioning, `position-area` and `position-try-fallbacks: flip-block`, CSS places a tooltip above its control, or below at the top edge, at the same pixels as `placeTooltip` today (tested side by side). A menu opened by a button lands under it and flips above near the bottom edge, with no JS for placement.

The context menu opens where the pointer is, and anchor positioning can't anchor to a point, so its JS stays. It takes the entry fade.

`interestfor` would open tooltips with no JS at all, but on keyboard focus it waits ~0.5s where today's shows at once, it shows on a long press where today's shows nothing on touch, and it gave the button no accessible description. Wait.

## What to adopt now, in order

1. ~~The connect steps' `accent-color` (one line).~~ Done in #173.
2. `field-sizing: content` on the held message and the review reason, and `:user-invalid` beside `[aria-invalid]`.
3. The field frame focus, with [ChatInput](/drift#d3-one-chatinput-for-the-four-places-a-person-asks) and [SearchField](/drift#d5-one-searchfield).
4. The customizable select, for Browse's filters and the model pickers.
5. The switch redraw and the locked state.
6. Anchor positioning and `popover="hint"` for tooltips, with the JS kept behind `CSS.supports("anchor-name: --a")` for a release; the entry fade for menus and tooltips.
7. `text-wrap`, `scrollbar-gutter` and the run line's smooth opening, as one polish story.

## Decisions for the maintainer

- ~~Whether "Add to…" stays a select or becomes a menu button.~~ **Decided 2026-11-05** (no story): it stays a select.
- ~~Whether the context menu's keyboard focus gets an inset ring, rather than the fill it shares with hover (drift D4).~~ **Decided 2026-11-05** (OA-253): an inset ring, distinct from hover.
- One entry fade: the popover lab's (`assets/proposals/popover.css`) and the "more" lab's (`.more-enter` in `assets/proposals/more.css`) both fade a menu in. Keep the popover lab's; the other is there to show `@starting-style` alone.
- Exit transitions: menus and tooltips leave instantly today, and the proposal keeps that.
