---
title: More modern CSS
status: proposed
order: 90
classes: more-unfold, more-enter, more-balance, more-pretty, more-scroll, more-scroll-row, more-stagger, more-scheme, run, run-body, code, output, context-menu, context-menu-item, button, page-title, panel-prose, ask-questions, ask-question
summary: The rest of modern CSS, judged for Oriel one feature at a time: light-dark(), color-mix(), @starting-style, interpolate-size, @scope, container queries, text-wrap, scrollbar-gutter, :has(), nesting, @layer and sibling-index().
---

# More modern CSS

## What it is

The features below aren't controls. They're the rest of what Chromium 156 can do that Oriel's `window.css` might use, each with a verdict. Where a feature shows something, a specimen shows it on Oriel's own markup, today's beside the proposal. The add-on classes are in `assets/proposals/more.css`.

Two facts decide most verdicts:

- The desktop app is Electron 45, which is Chromium 156. Every feature here works there.
- `window.css` also styles the review link page, which may open in Safari or Firefox. A feature that changes behaviour, not only polish, must not reach a rule that page uses, or must sit inside `@supports`.

| Feature                                 | Oriel today                                                          | Verdict                                                       |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `light-dark()`                          | 0 uses; themes are `[data-theme]` blocks with `prefers-color-scheme` | Doesn't apply. Keep the blocks                                |
| `color-mix()`                           | 34 uses                                                              | Keep using it                                                 |
| `@starting-style`, `allow-discrete`     | 3 uses, no `allow-discrete`                                          | Adopt now for menus and the confirm dialog                    |
| `interpolate-size`, `::details-content` | 0                                                                    | Adopt now, as desktop polish                                  |
| `@scope`                                | 0                                                                    | Not needed: class prefixes do the job                         |
| Container queries                       | 3 size queries                                                       | Keep; style queries only where a token should switch a layout |
| `text-wrap: balance`, `pretty`          | 0                                                                    | Adopt now                                                     |
| `scrollbar-gutter: stable`              | 0                                                                    | Adopt now, on the rail, the item panel and the window chat    |
| `:has()`                                | 9 uses                                                               | Keep using it                                                 |
| Nesting                                 | 0                                                                    | Wait: Oriel's own CSS tools don't read it                     |
| `@layer`                                | 0                                                                    | Not needed                                                    |
| `sibling-index()`                       | 0                                                                    | Adopt now for staggers; nothing needs one yet                 |

## Today

What Oriel ships, beside each proposal below: a run line that snaps open, a context menu that appears at once, titles that wrap where they fall, and scrolling columns whose rows change width when a scrollbar appears.

```html specimen id=today-run title="A run line today: it snaps open (Run, in thread-page.tsx)" side=today
<details class="run" data-outcome="ok">
  <summary>Ran a script · 3 reads · 412 ms</summary>
  <div class="run-body">
    <pre class="code">
const items = await jira.search("project = SYN AND status = 'In Progress'");
return items.filter((item) => item.labels.includes("wallets")).length;</pre>
    <pre class="output">2</pre>
  </div>
</details>
```

```html specimen id=proposed-run title="With .more-unfold: it unfolds over --duration-move" side=proposed
<details class="run more-unfold" data-outcome="ok">
  <summary>Ran a script · 3 reads · 412 ms</summary>
  <div class="run-body">
    <pre class="code">
const items = await jira.search("project = SYN AND status = 'In Progress'");
return items.filter((item) => item.labels.includes("wallets")).length;</pre>
    <pre class="output">2</pre>
  </div>
</details>
```

## Proposed

### light-dark()

`light-dark(a, b)` picks `a` or `b` by the element's used `color-scheme`. It's built for a stylesheet whose light and dark values sit side by side. Oriel's don't: each theme is a `:root[data-theme]` block of tokens and a dark block under `@media (prefers-color-scheme: dark)` in `window.css`, and every rule reads the tokens. A rule never needs to know the scheme, so there's nothing for `light-dark()` to choose between.

It would also tie a colour to `color-scheme` instead of to the token blocks. Oriel sets `color-scheme: light dark` on `html` in `window.css`, so both follow the system today and agree. A theme that's always dark, or a "dark in the app, whatever the system" setting, would split them. The swatch shows the split: the workshop forces the scheme by rewriting the media queries, but `light-dark()` still follows the system's `color-scheme`. In a Broadsheet dark frame on a light system it takes the light branch.

```html specimen id=light-dark title="light-dark(): done's tint for the light branch, danger's for the dark" side=proposed
<p class="more-scheme">
  This swatch is green when light-dark() took its light branch, and red when it took its dark one.
</p>
```

**Verdict: doesn't apply.** Keep the token blocks. Use `light-dark()` only if Oriel ever sets `color-scheme` per theme and wants a native control's colour to follow.

### color-mix()

Already used 34 times, all for tints and lines mixed from a theme's tokens: `--accent-soft` and each state's soft colour from `--tint`; `--sidebar-bg` and `--scrim` in `window.css`; and the type marks (`--type-story` in `window.css`). It's what lets a theme set five colours and get twenty. It's Baseline, and an old engine would drop the declaration, which the review page doesn't depend on.

**Verdict: keep using it.** Any new tint should be mixed, not picked.

### @starting-style and allow-discrete

Oriel already animates the item panel's and the window chat's entry with `@starting-style` in `window.css`. Its menus and its confirm dialog appear at once, and vanish at once. `transition-behavior: allow-discrete` lets a popover or a `<dialog>` stay in the top layer while it fades out, so the exit can be animated too, with no script.

Click each button. Today's menu appears at once; the proposed one fades and rises in over `--duration-quick`, and fades out the same way. Escape or a click outside closes both.

```html specimen id=today-menu title="A context menu today: no entry, no exit" side=today height=200
<button type="button" class="button" popovertarget="today-thread-menu">Thread actions</button>
<div id="today-thread-menu" popover class="context-menu" role="menu" aria-label="Thread actions">
  <button type="button" class="context-menu-item" role="menuitem">Rename</button>
  <button type="button" class="context-menu-item" role="menuitem">Move to Gift cards</button>
  <button type="button" class="context-menu-item" role="menuitem">Mark done</button>
</div>
```

```html specimen id=proposed-menu title="With .more-enter: it fades in, and out" side=proposed height=200
<button type="button" class="button" popovertarget="proposed-thread-menu">Thread actions</button>
<div
  id="proposed-thread-menu"
  popover
  class="context-menu more-enter"
  role="menu"
  aria-label="Thread actions"
>
  <button type="button" class="context-menu-item" role="menuitem">Rename</button>
  <button type="button" class="context-menu-item" role="menuitem">Move to Gift cards</button>
  <button type="button" class="context-menu-item" role="menuitem">Mark done</button>
</div>
```

The menu sits where the page left it here, because Oriel places its menus with script (`ContextMenu` in `packages/web/src/menu.tsx`); the [popover lab](/lab/popover) is about placing them with anchor positioning instead.

**Verdict: adopt now** for the context menu, the tooltip and the confirm dialog (`.context-menu` and `.confirm::backdrop` in `window.css`). Safari 17.5 and Firefox 129 have both features; an older engine shows and hides at once, as today. Keep it inside the reduced-motion rule (`@media (prefers-reduced-motion: reduce)` in `window.css`).

### interpolate-size and ::details-content

`interpolate-size: allow-keywords` lets `block-size` animate to `auto`. `::details-content` is the part of a `<details>` that opens. Together they unfold a run line, a diff's folded lines (`Unchanged` in `packages/web/src/thread-page.tsx`) or a workstream's history (`History` in `packages/web/src/workstream-page.tsx`) instead of snapping them open. Open the run line under [Today](#today) beside the proposed one to compare.

Safari and Firefox have `::details-content` but not `interpolate-size`, so there the details snaps open, exactly as today. The `block-size: 0` on a closed details changes nothing there, because closed content is already hidden.

**Verdict: adopt now, as desktop polish.** Don't depend on it: nothing may wait for the animation to end. `calc-size()` does the same for one property at a time; `interpolate-size` on the details is simpler.

### @scope

`@scope (.chat-input) to (.chip) { … }` limits rules to a subtree, and stops at an inner one. Oriel gets the same from class prefixes: `.chat-input-field`, `.settings-field-name`, `.provider-path-label`. The workshop's check already refuses a proposal whose class collides with one of window.css's. `@scope` would allow shorter names, at the cost of a second way to scope. Oriel's CSS reader keeps a scoped rule's `@scope` prelude, so its theme check would still judge the declarations.

**Verdict: not needed.** Revisit if the prefixes get long enough to hurt.

### Container queries

Oriel uses size queries already: the page and the overview are containers (`body` and `.overview` in `window.css`), and the overview's layout changes at 900px of its own width (`@container overview (min-width: 900px)` in `window.css`). Style queries, `@container style(--x: y)`, could let a theme token switch a layout: a theme with `--list-frame: none` could drop a list's frame without a `[data-theme]` selector. Safari 18 and Firefox 151 have them; the range syntax, `style(--x > 2)`, is Chromium's only.

**Verdict: keep the size queries.** Use a style query where a theme's token should change a layout, never the range syntax.

### text-wrap: balance and pretty

`balance` evens out the lines of a short block, such as a title. `pretty` avoids a single word alone on a paragraph's last line. Both only change where lines break.

```html specimen id=today-title title="A long title today, at 390px" side=today width=390
<h1 class="page-title">Checkout v2: phone wallets, saved cards and gift cards</h1>
```

```html specimen id=proposed-title title="With .more-balance" side=proposed width=390
<h1 class="page-title more-balance">Checkout v2: phone wallets, saved cards and gift cards</h1>
```

```html specimen id=today-prose title="Prose today: one word on the last line" side=today width=390
<p class="panel-prose">
  Click <strong>Copy</strong>, then paste it above. Atlassian shows it only once.
</p>
```

```html specimen id=proposed-prose title="With .more-pretty: two" side=proposed width=390
<p class="panel-prose more-pretty">
  Click <strong>Copy</strong>, then paste it above. Atlassian shows it only once.
</p>
```

**Verdict: adopt now.** `balance` on the page, thread, panel and setup titles; `pretty` on prose (a reply, a lede, a connect step's help). Firefox doesn't have `pretty` and wraps normally; nothing else changes.

### scrollbar-gutter: stable

A scrolling column reserves room for its scrollbar only once it overflows, so its rows narrow when the list grows past the column. `scrollbar-gutter: stable` keeps the room from the start. Compare the right edges of each pair of lists.

```html specimen id=today-gutter title="Today: the short list's rows are wider than the long list's" side=today
<div class="ws-row">
  <ul class="more-scroll" aria-label="Workstreams, short">
    <li class="more-scroll-row"><span>Gift cards</span><span>4</span></li>
    <li class="more-scroll-row"><span>SMS updates</span><span>3</span></li>
  </ul>
  <ul class="more-scroll" aria-label="Workstreams, long" tabindex="0">
    <li class="more-scroll-row"><span>Gift cards</span><span>4</span></li>
    <li class="more-scroll-row"><span>SMS updates</span><span>3</span></li>
    <li class="more-scroll-row"><span>Checkout v2</span><span>17</span></li>
    <li class="more-scroll-row"><span>Vehicle and freight</span><span>11</span></li>
    <li class="more-scroll-row"><span>Kiosk wallets</span><span>6</span></li>
    <li class="more-scroll-row"><span>Rebooking</span><span>9</span></li>
  </ul>
</div>
```

```html specimen id=proposed-gutter title="With data-gutter (scrollbar-gutter: stable): the rows match" side=proposed
<div class="ws-row">
  <ul class="more-scroll" data-gutter aria-label="Workstreams, short">
    <li class="more-scroll-row"><span>Gift cards</span><span>4</span></li>
    <li class="more-scroll-row"><span>SMS updates</span><span>3</span></li>
  </ul>
  <ul class="more-scroll" data-gutter aria-label="Workstreams, long" tabindex="0">
    <li class="more-scroll-row"><span>Gift cards</span><span>4</span></li>
    <li class="more-scroll-row"><span>SMS updates</span><span>3</span></li>
    <li class="more-scroll-row"><span>Checkout v2</span><span>17</span></li>
    <li class="more-scroll-row"><span>Vehicle and freight</span><span>11</span></li>
    <li class="more-scroll-row"><span>Kiosk wallets</span><span>6</span></li>
    <li class="more-scroll-row"><span>Rebooking</span><span>9</span></li>
  </ul>
</div>
```

With overlay scrollbars (macOS's default, "show scroll bars when scrolling") there's no gutter to keep and the two pairs look the same; the difference shows with "always", and on Windows and Linux.

**Verdict: adopt now** on the columns that scroll on their own: the sidebar (`.sidebar` in `window.css`), the rail (`.rail` in `window.css`), the item panel (`.item-panel` in `window.css`) and the window chat's entries (`.window-chat-entries` in `window.css`). Safari 18.2 and Firefox 97 have it.

### :has()

Used 7 times already, such as a change set's head that makes room for its quiet action (`.change-set-head:has(> .quiet-action)` in `window.css`) and a draft's option rows that change layout when they hold a textarea (`.draft-changes dd:not(:has(textarea))` in `window.css`). The [select](/lab/select) proposal uses it to make a filter quiet until it's set, with no `data-set` attribute. It's Baseline.

**Verdict: keep using it**, where it replaces an attribute set in JS only for styling.

### Nesting and @layer

Nesting writes `.run { & summary { … } }`. Every engine Oriel meets has it. But Oriel's CSS is flat, and its own tools read it flat: the parser, `parse` in `packages/web/themes.ts`, which Oriel's theme check and this workshop share, returns a nested rule with its selector as written (`&:hover`), cut off from its parent. The theme check would still judge its values, but anything keyed on a selector (the workshop's forced states, its class checks, a theme block found by its selector) would misread it.

`@layer` orders groups of rules regardless of source order. Oriel has one stylesheet, written in an order, with specificity kept low by single classes; nothing fights. Layering it would mean putting every rule in a layer, or unlayered rules would beat layered ones.

**Verdict: wait on nesting** until there's a reason beyond shorter source, and the parser understands it. **`@layer`: not needed** while there's one sheet.

### sibling-index()

`sibling-index()` is an element's position among its siblings, in CSS. It makes a stagger without a `--i` set from JSX. Open the details: each question arrives a moment after the one before it. Where the engine lacks `sibling-index()` (Firefox before 154), the delay is dropped and they arrive together.

```html specimen id=stagger title="Questions to start from, staggered by sibling-index()" side=proposed height=140
<details>
  <summary>Questions to start from</summary>
  <ul class="ask-questions more-stagger" aria-label="Questions to start from">
    <li><button type="button" class="ask-question">What moved in Payments?</button></li>
    <li><button type="button" class="ask-question">Why is Checkout v2 stalled?</button></li>
    <li>
      <button type="button" class="ask-question">Which stories here still need estimates?</button>
    </li>
  </ul>
</details>
```

**Verdict: adopt now** when Oriel wants a stagger. Nothing in the window staggers today, and nothing needs to.

## States

These are features, not controls, so most have no states of their own. What changes:

- **Reduced motion:** every animation on this page (the unfolding run line, the menu's fade, the stagger) is off under `prefers-reduced-motion: reduce`, as window.css's own are (`@media (prefers-reduced-motion: reduce)` in `window.css`).
- **Themes:** every value is a token, so Broadsheet's square corners and each dark scheme apply. `light-dark()` is the exception, and the reason it's turned down.
- **Focus:** unchanged. The summaries, the menu buttons and the scrolling lists keep the window's outline.

## Keyboard and ARIA

- None of these features changes the keyboard. A `<details>` still opens with Enter or Space on its summary; a popover still closes with Escape; a scrolling list with `tabindex="0"` still scrolls with the arrow keys.
- An animation never delays focus or input: the menu's items can be reached while it fades in, and a run line's content is in the accessibility tree from the moment it opens.
- `text-wrap` changes only where lines break, never the words or their order.

## Support and fallback

| Feature                               | Chromium          | Desktop (Chromium 156) | Safari / Firefox                                            | Fallback                                            |
| ------------------------------------- | ----------------- | ---------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `light-dark()`                        | 123               | Yes                    | Safari 17.5, Firefox 120                                    | The declaration drops; keep a plain value before it |
| `color-mix()`                         | 111               | Yes                    | Baseline 2023                                               | The declaration drops                               |
| `@starting-style`                     | 117               | Yes                    | Safari 17.5, Firefox 129                                    | No entry animation                                  |
| `transition-behavior: allow-discrete` | 117               | Yes                    | Safari 17.4, Firefox 129                                    | No exit animation                                   |
| `interpolate-size`, `calc-size()`     | 129               | Yes                    | Neither                                                     | The details snaps open, as today                    |
| `::details-content`                   | 131               | Yes                    | Safari 18.4, Firefox 143                                    | The rule doesn't apply                              |
| `@scope`                              | 118               | Yes                    | Safari 26.2, Firefox 146                                    | The whole block drops in an older engine            |
| Container size queries                | 105               | Yes                    | Baseline 2023                                               | The rules don't apply                               |
| Container style queries               | 111               | Yes                    | Safari 18, Firefox 151; the range syntax is Chromium's only | The rules don't apply                               |
| `text-wrap: balance`                  | 114               | Yes                    | Safari 17.5, Firefox 121                                    | Normal wrapping                                     |
| `text-wrap: pretty`                   | 117               | Yes                    | Safari 26; Firefox no                                       | Normal wrapping                                     |
| `scrollbar-gutter`                    | 94                | Yes                    | Safari 18.2, Firefox 97                                     | Rows narrow when the scrollbar appears              |
| `:has()`                              | 105               | Yes                    | Safari 15.4, Firefox 121                                    | The rules don't apply                               |
| Nesting                               | 112 (relaxed 120) | Yes                    | Baseline 2023                                               | Nested rules drop in an older engine                |
| `@layer`                              | 99                | Yes                    | Baseline 2022                                               | The whole layer drops in an older engine            |
| `sibling-index()`                     | 138               | Yes                    | Safari 26.2, Firefox 154                                    | The declaration drops                               |

What was tried, in headless Chrome 156:

- The proposed run line's height goes 21, 78, 146, 156, 161px over the first 200ms after a click; today's is 161px at once.
- The proposed menu's opacity is about 0.5 thirty milliseconds after it opens, and 1 by 330ms. After Escape it's no longer `:popover-open` but still displayed, at about 0.5, while it fades: that's `allow-discrete`.
- At 390px, today's title breaks as "Checkout v2: phone wallets, saved cards and" over "gift cards"; balanced, its two lines are nearly the same length. With `pretty`, the connect step's line ends "only once." instead of a lone "once.".
- The questions' transition delays compute to 0s, 0.06s and 0.12s, and just after the details opens their opacities are 0.65, 0 and 0.
- In a Broadsheet dark frame, the `light-dark()` swatch is green: the light branch, because the system was light.
- With classic scrollbars (headless Chrome hides them by default, and macOS overlays them), the long list's rows are 187px and the short list's 198px; with `data-gutter` both are 187px. With overlay scrollbars both are 198px either way.

Not tried: Safari, and clicking in Firefox (its headless mode only takes a picture). By the tables, Firefox 142 would fade the menu (it has `@starting-style` and `allow-discrete`) and snap the run line open (`::details-content` came in 143).

## Adopt now or wait

- **Adopt now:** `@starting-style` with `allow-discrete` for menus, tooltips and the confirm dialog; `interpolate-size` with `::details-content` for run lines, folds and history (polish, desktop only); `text-wrap: balance` on titles and `pretty` on prose; `scrollbar-gutter: stable` on the scrolling columns.
- **Keep using:** `color-mix()`, `:has()`, container size queries.
- **Use when needed:** container style queries, `sibling-index()`.
- **Don't:** `light-dark()` (the token blocks already do it), `@scope` (prefixes do it), `@layer` (one sheet).
- **Wait:** nesting, until Oriel's CSS parser reads it.

## How to migrate

1. **Unfolding details:** add `interpolate-size: allow-keywords` and the `::details-content` rules to `.run`, `.fold` and `.history` (`.run` in `window.css`; the markup is `Run` and `Unchanged` in `packages/web/src/thread-page.tsx` and `History` in `packages/web/src/workstream-page.tsx`), and add the `::details-content` selectors to the reduced-motion rule (`@media (prefers-reduced-motion: reduce)` in `window.css`).
2. **Menus:** add `.more-enter`'s transition and its `@starting-style` to `.context-menu` and `.tooltip` in `window.css`; for the confirm dialog, the same on `.confirm` and `.confirm::backdrop` (`.confirm` and `.confirm::backdrop` in `window.css`). No change to `packages/web/src/menu.tsx`.
3. **Text wrap:** `text-wrap: balance` on `.page-title` and `.thread-title` in `window.css` and the panel's and setup's titles; `text-wrap: pretty` on `.panel-prose` and the ledes.
4. **Gutters:** `scrollbar-gutter: stable` on `.sidebar`, `.rail`, `.item-panel` and `.window-chat-entries` in `window.css`.
5. Shots to retake: a thread with a run line, the sidebar with many threads, and a page with a long title, in each theme.
