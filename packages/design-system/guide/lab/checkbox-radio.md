---
title: Checkbox and radio
status: proposed
order: 20
summary: Oriel's checkboxes and radios are the browser's, tinted with accent-color. A drawn version with appearance none, beside them in every state, and why accent-color is enough for now.
classes: checkbox, radio, pick, anchor-pick, choice, choices, choice-rows, choice-row
---

# Checkbox and radio

## What it is

Oriel has two checkboxes and three kinds of radio, all native `<input>`s:

- **Browse's pick** (`.pick`): a checkbox on each item row, and one on a cluster's heading for its anchor, the epic itself. It waits, invisible, until the row is pointed at or something is picked.
- **Settings' choices** (`.choice`): a few radios under a setting's name, such as "Times".
- **The connect steps' rows** (`.choice-row`): one radio per row, such as a Jira project, with the picked row tinted.

Today the first two are tinted with `accent-color: var(--accent)`, and the browser draws the rest. The third has no rule at all, so its radio is the browser's default blue.

The proposal draws both controls with Oriel's tokens: `appearance: none` on the real `<input>`, then a border, a fill and a mark. The input stays an input, so its name, its state, its keys and its label all stay the browser's. Picked is the accent, "your choice made", as the [switch](/lab/switch) says.

**The short answer:** `accent-color` is enough for Oriel today. Add it to the connect steps' radios, which lack it, and keep the browser's drawing. Draw them only if the text-size setting or a cross-engine look starts to matter. See [Adopt now or wait](#adopt-now-or-wait).

## Today

Oriel's own markup and CSS. `data-picking` is what the app sets on Browse once something is picked (`Body` in `packages/web/src/window-page.tsx`), so every pick shows.

```html specimen id=today-browse title="Browse: an item's pick and the anchor's pick (accent-color)" side=today
<section class="cluster" data-open data-anchored data-picking>
  <h2 class="cluster-head picked">
    <label class="pick anchor-pick" title="Pick SYN-1 itself, not its items">
      <input type="checkbox" checked aria-label="Pick Checkout v2: phone wallets and saved cards" />
    </label>
    <button type="button" class="cluster-toggle" aria-expanded="true">
      <span class="cluster-name">
        <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
        <span class="key">SYN-1</span>
      </span>
    </button>
  </h2>
  <ul class="items">
    <li class="item picked">
      <label class="pick"
        ><input type="checkbox" checked aria-label="Pick Pay with a phone wallet on the website"
      /></label>
      <a class="key source-link" href="#"><span class="type" data-type="story"></span>SYN-23</a>
      <span class="title">Pay with a phone wallet on the website</span>
      <span class="status" data-category="in-progress">In Progress</span>
    </li>
    <li class="item">
      <label class="pick"
        ><input type="checkbox" aria-label="Pick Remove the legacy web-view checkout"
      /></label>
      <a class="key source-link" href="#"><span class="type" data-type="story"></span>SYN-10</a>
      <span class="title">Remove the legacy web-view checkout</span>
      <span class="status" data-category="todo">To Do</span>
    </li>
  </ul>
</section>
```

```html specimen id=proposed-browse title="Browse, drawn: .checkbox on the same inputs" side=proposed
<section class="cluster" data-open data-anchored data-picking>
  <h2 class="cluster-head picked">
    <label class="pick anchor-pick" title="Pick SYN-1 itself, not its items">
      <input
        type="checkbox"
        class="checkbox"
        checked
        aria-label="Pick Checkout v2: phone wallets and saved cards"
      />
    </label>
    <button type="button" class="cluster-toggle" aria-expanded="true">
      <span class="cluster-name">
        <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
        <span class="key">SYN-1</span>
      </span>
    </button>
  </h2>
  <ul class="items">
    <li class="item picked">
      <label class="pick"
        ><input
          type="checkbox"
          class="checkbox"
          checked
          aria-label="Pick Pay with a phone wallet on the website"
      /></label>
      <a class="key source-link" href="#"><span class="type" data-type="story"></span>SYN-23</a>
      <span class="title">Pay with a phone wallet on the website</span>
      <span class="status" data-category="in-progress">In Progress</span>
    </li>
    <li class="item">
      <label class="pick"
        ><input
          type="checkbox"
          class="checkbox"
          aria-label="Pick Remove the legacy web-view checkout"
      /></label>
      <a class="key source-link" href="#"><span class="type" data-type="story"></span>SYN-10</a>
      <span class="title">Remove the legacy web-view checkout</span>
      <span class="status" data-category="todo">To Do</span>
    </li>
  </ul>
</section>
```

```html specimen id=today-choices title="Settings: a setting's choices (accent-color)" side=today
<fieldset class="settings-field">
  <legend class="settings-field-name">Times</legend>
  <span class="settings-field-about"
    >How Oriel writes when something happened, everywhere but a review link's page.</span
  >
  <div class="choices">
    <label class="choice"
      ><input type="radio" name="today-times" value="relative" checked />Relative, such as 3 min
      ago</label
    >
    <label class="choice"
      ><input type="radio" name="today-times" value="absolute" />Date and time, such as Nov 3,
      09:41</label
    >
  </div>
</fieldset>
```

```html specimen id=proposed-choices title="Settings, drawn: .radio" side=proposed
<fieldset class="settings-field">
  <legend class="settings-field-name">Times</legend>
  <span class="settings-field-about"
    >How Oriel writes when something happened, everywhere but a review link's page.</span
  >
  <div class="choices">
    <label class="choice"
      ><input type="radio" class="radio" name="proposed-times" value="relative" checked />Relative,
      such as 3 min ago</label
    >
    <label class="choice"
      ><input type="radio" class="radio" name="proposed-times" value="absolute" />Date and time,
      such as Nov 3, 09:41</label
    >
  </div>
</fieldset>
```

```html specimen id=today-rows title="Connect steps: rows to pick one from (no accent-color: the browser's blue)" side=today
<ul class="choice-rows" role="radiogroup" aria-label="Projects">
  <li data-picked>
    <label class="choice-row">
      <input type="radio" name="today-project" value="SYN" checked />
      <span class="choice-text"
        ><span class="choice-name">Ferrowick</span
        ><span class="choice-detail">SYN · 29 issues · changed Nov 3</span></span
      >
    </label>
  </li>
  <li>
    <label class="choice-row">
      <input type="radio" name="today-project" value="OPS" />
      <span class="choice-text"
        ><span class="choice-name">Ferrowick operations</span
        ><span class="choice-detail">OPS · 112 issues · changed Oct 28</span></span
      >
    </label>
  </li>
</ul>
```

```html specimen id=proposed-rows title="Connect steps, drawn: .radio, now the accent" side=proposed
<ul class="choice-rows" role="radiogroup" aria-label="Projects">
  <li data-picked>
    <label class="choice-row">
      <input type="radio" class="radio" name="proposed-project" value="SYN" checked />
      <span class="choice-text"
        ><span class="choice-name">Ferrowick</span
        ><span class="choice-detail">SYN · 29 issues · changed Nov 3</span></span
      >
    </label>
  </li>
  <li>
    <label class="choice-row">
      <input type="radio" class="radio" name="proposed-project" value="OPS" />
      <span class="choice-text"
        ><span class="choice-name">Ferrowick operations</span
        ><span class="choice-detail">OPS · 112 issues · changed Oct 28</span></span
      >
    </label>
  </li>
</ul>
```

## Proposed

`assets/proposals/choice.css`. Two classes, each on the `<input>` itself:

- `.checkbox`: a 1rem box, `--radius-sm`, a `--border-thin` edge in `--text-faint` on `--surface`. Picked: `--accent` fill with a tick in `--on-accent`. Part-picked: the same fill with a bar.
- `.radio`: the same, round, with a dot.

What it changes from today:

- **It follows the text size.** The box is 1rem, so Settings' Large text makes it larger: 16px, and 18px at Large. The browser's checkbox stays 13px whatever the text size (measured in Chrome 156). Set the guide's Text size to Large to compare.
- **Its edge is a token.** `--text-faint` is 5.4:1 to 6.3:1 against `--surface` across Graphite and Broadsheet, light and dark, so the unpicked box clears the 3:1 a control's edge needs. The browser's grey clears it too, in Chromium; the drawn edge just stops depending on that.
- **It's one drawing in every engine.** `accent-color` is honoured everywhere, but Safari and Firefox each draw their own box and tick around it.
- **Hover is styled** (the edge darkens to `--text-muted`). Today nothing changes under the pointer except the row.
- **Focus is the same.** It's window.css's ring (`:focus-visible` in `window.css`), as on every control.

What it costs: about 90 lines of CSS to keep, a tick drawn with `clip-path`, and a fallback for Windows' high-contrast mode, where the drawn tick would vanish; there it hands back to the browser's drawing (`appearance: auto`; checked with Chrome's forced-colours emulation).

## States

Each pair is today's (left) and drawn (right). Hover and focus are forced with `ws-hover` and `ws-focus-visible`; everything else is the input's real state.

```html specimen id=today-states-check title="Checkbox today: rest, hover, focus, picked, part-picked, disabled" side=today
<div class="ws-row" data-picking>
  <label class="pick"><input type="checkbox" aria-label="Pick SYN-10 (rest)" /></label>
  <label class="pick"
    ><input type="checkbox" class="ws-hover" aria-label="Pick SYN-10 (hover)"
  /></label>
  <label class="pick"
    ><input type="checkbox" class="ws-focus-visible" aria-label="Pick SYN-10 (focus)"
  /></label>
  <label class="pick"><input type="checkbox" checked aria-label="Pick SYN-23 (picked)" /></label>
  <label class="pick"
    ><input type="checkbox" data-ws-indeterminate aria-label="Pick SYN-1 (part-picked)"
  /></label>
  <label class="pick"><input type="checkbox" disabled aria-label="Pick SYN-21 (disabled)" /></label>
  <label class="pick"
    ><input type="checkbox" checked disabled aria-label="Pick SYN-22 (picked, disabled)"
  /></label>
</div>
```

```html specimen id=proposed-states-check title="Checkbox drawn: the same states" side=proposed
<div class="ws-row" data-picking>
  <label class="pick"
    ><input type="checkbox" class="checkbox" aria-label="Pick SYN-10 (rest)"
  /></label>
  <label class="pick"
    ><input type="checkbox" class="checkbox ws-hover" aria-label="Pick SYN-10 (hover)"
  /></label>
  <label class="pick"
    ><input type="checkbox" class="checkbox ws-focus-visible" aria-label="Pick SYN-10 (focus)"
  /></label>
  <label class="pick"
    ><input type="checkbox" class="checkbox" checked aria-label="Pick SYN-23 (picked)"
  /></label>
  <label class="pick"
    ><input
      type="checkbox"
      class="checkbox"
      data-ws-indeterminate
      aria-label="Pick SYN-1 (part-picked)"
  /></label>
  <label class="pick"
    ><input type="checkbox" class="checkbox" disabled aria-label="Pick SYN-21 (disabled)"
  /></label>
  <label class="pick"
    ><input
      type="checkbox"
      class="checkbox"
      checked
      disabled
      aria-label="Pick SYN-22 (picked, disabled)"
  /></label>
</div>
```

```html specimen id=today-states-radio title="Radio today: rest, hover, focus, picked, disabled" side=today
<div class="choices">
  <label class="choice"
    ><input type="radio" name="today-every" value="start" />When Oriel starts, and when you
    ask</label
  >
  <label class="choice"
    ><input type="radio" name="today-every" value="5" class="ws-hover" />Every 5 minutes
    (hover)</label
  >
  <label class="choice"
    ><input type="radio" name="today-every" value="15" class="ws-focus-visible" />Every 15 minutes
    (focus)</label
  >
  <label class="choice"
    ><input type="radio" name="today-every" value="60" checked />Every hour</label
  >
  <label class="choice"
    ><input type="radio" name="today-wait" value="start" disabled />When Oriel starts, and when you
    ask (disabled)</label
  >
  <label class="choice"
    ><input type="radio" name="today-wait" value="60" checked disabled />Every hour (picked,
    disabled)</label
  >
</div>
```

```html specimen id=proposed-states-radio title="Radio drawn: the same states" side=proposed
<div class="choices">
  <label class="choice"
    ><input type="radio" class="radio" name="proposed-every" value="start" />When Oriel starts, and
    when you ask</label
  >
  <label class="choice"
    ><input type="radio" class="radio ws-hover" name="proposed-every" value="5" />Every 5 minutes
    (hover)</label
  >
  <label class="choice"
    ><input type="radio" class="radio ws-focus-visible" name="proposed-every" value="15" />Every 15
    minutes (focus)</label
  >
  <label class="choice"
    ><input type="radio" class="radio" name="proposed-every" value="60" checked />Every hour</label
  >
  <label class="choice"
    ><input type="radio" class="radio" name="proposed-wait" value="start" disabled />When Oriel
    starts, and when you ask (disabled)</label
  >
  <label class="choice"
    ><input type="radio" class="radio" name="proposed-wait" value="60" checked disabled />Every hour
    (picked, disabled)</label
  >
</div>
```

```html specimen id=today-invalid title="Wrong today: no style; the browser shows nothing until submit" side=today state=error
<fieldset class="settings-field">
  <legend class="settings-field-name">Which Jira project?</legend>
  <div class="choices">
    <label class="choice"
      ><input type="radio" name="today-need" value="SYN" required aria-invalid="true" />Ferrowick
      (SYN)</label
    >
    <label class="choice"
      ><input type="radio" name="today-need" value="OPS" required aria-invalid="true" />Ferrowick
      operations (OPS)</label
    >
  </div>
  <p class="connect-problem" role="alert">Pick a project to go on.</p>
</fieldset>
```

```html specimen id=proposed-invalid title="Wrong, drawn: the edge in --danger (:user-invalid or aria-invalid)" side=proposed state=error
<fieldset class="settings-field">
  <legend class="settings-field-name">Which Jira project?</legend>
  <div class="choices">
    <label class="choice"
      ><input
        type="radio"
        class="radio"
        name="proposed-need"
        value="SYN"
        required
        aria-invalid="true"
      />Ferrowick (SYN)</label
    >
    <label class="choice"
      ><input
        type="radio"
        class="radio"
        name="proposed-need"
        value="OPS"
        required
        aria-invalid="true"
      />Ferrowick operations (OPS)</label
    >
  </div>
  <p class="connect-problem" role="alert">Pick a project to go on.</p>
</fieldset>
```

- **Rest, picked, disabled:** both versions have them. Disabled is `opacity: 0.5`, Oriel's disabled everywhere. In the app, a connection's radios are disabled while a pick is saving (`PickOption` in `packages/web/src/connections-page.tsx`); no checkbox is ever disabled.
- **Hover:** today only the row changes (`.item:hover`). Drawn, the edge darkens too.
- **Focus-visible:** window.css's ring in both. Nothing to add.
- **Active:** not styled in either; window.css has no `:active` rule anywhere.
- **Part-picked (`:indeterminate`):** **Oriel doesn't use it**, and the obvious place for it would be wrong. The anchor's pick is "Pick SYN-1 itself, not its items" (`Cluster` in `packages/web/src/window-page.tsx`): it picks the epic as one more item. A bar there, when some of its items are picked, would say "some of these are picked" on a box that picks something else, and clicking it would pick the epic, not the rest. Keep the anchor's pick two-state. If Browse ever gets a "pick all of this cluster's items" box, that box is the one to make part-picked. Both versions draw the state; the drawn one is a bar in the accent.
- **Wrong (`:user-invalid`):** Oriel has no required checkbox or radio, and a radio group in Oriel always has one picked. The drawn version reddens the edge on `:user-invalid` (after the person has had a go) or `aria-invalid="true"` (what Oriel sets on fields today, `.input[aria-invalid]` in `window.css`), and the words still say what's wrong, in a `role="alert"` line. Today's radio can't be reddened at all.
- **Busy, empty:** don't apply.

## Keyboard and ARIA

Nothing changes, which is the reason to keep the real `<input>`:

- **Checkbox:** Tab reaches it, Space toggles it. A click on its `<label>` toggles it.
- **Radio:** Tab reaches the picked one in a group (or the first, with none picked), the arrow keys move and pick within the `name` group, and Space picks.
- **Names:** Browse's picks are named by `aria-label` ("Pick Pay with a phone wallet on the website"), since the row's title is a link beside it. Settings' radios are named by their `<label>` text, inside a `<fieldset>` whose `<legend>` names the group. Keep both.
- **Roles and states** come from the element: checkbox or radio, checked, mixed (for `indeterminate`), disabled, invalid. `appearance: none` changes none of them; the check confirms each still has a name in both themes.
- The connect steps' list adds `role="radiogroup"` on the `<ul>` and its `aria-label` ("Projects"). That's right, and unchanged.

## Support and fallback

| Feature                                   | Chromium | Desktop (Chromium 156) | Safari / Firefox                                   | Fallback                                        |
| ----------------------------------------- | -------- | ---------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `accent-color` (today)                    | 93       | Yes                    | Safari 15.4, Firefox 92                            | The browser's own colour                        |
| `appearance: none` on a checkbox or radio | 84       | Yes                    | Safari 15.4, Firefox 80                            | None needed; every current engine has it        |
| `::before` on an `appearance: none` input | Yes      | Yes                    | Yes                                                | n/a                                             |
| `clip-path: polygon()` for the tick       | 55       | Yes                    | Safari 13.1, Firefox 54                            | n/a                                             |
| `:indeterminate`                          | Yes      | Yes                    | Yes                                                | n/a                                             |
| `:user-invalid`                           | 119      | Yes                    | Safari 16.5, Firefox 88                            | `[aria-invalid="true"]` in the same rule        |
| `@media (forced-colors: active)`          | 89       | Yes                    | Firefox 89; Safari no (no forced colours on macOS) | `appearance: auto` there, the browser's drawing |

Nothing here needs `@supports`: an engine that ignored `appearance: none` would show the browser's checkbox, which is today. None of these controls is on the review link's page.

## Adopt now or wait

**Wait, and adopt one line now.**

- **Now:** add `accent-color: var(--accent)` to the connect steps' radios, which have none and show the browser's blue (`.choice-row` in `window.css` needs a `.choice-row input` beside it). That's the only visible inconsistency today.
- **Wait** on drawing. `accent-color` already does the one thing that matters, the accent when picked, in every engine, for free. The drawn version wins on following the text size and on one look across engines, but Oriel's controls run in one engine (the desktop app), and none of them is on the shared review page. Revisit if a text-size complaint lands, or if a form with required choices arrives and needs a red edge.
- **Don't** make the anchor's pick part-picked. See States.

## How to migrate

If drawing is adopted:

1. Paste `assets/proposals/choice.css` into window.css after `.pick input`, and delete the two `accent-color` lines it replaces, in `.pick input` and `.choice input` in `window.css`.
2. Add `class="checkbox"` to the two pick inputs, which `Cluster` and `Item` in `packages/web/src/window-page.tsx` draw.
3. Add `class="radio"` to the radios of `Choices` in `packages/web/src/settings-page.tsx`, `PickOption` in `packages/web/src/connections-page.tsx` and `PickStep` in `packages/web/src/connect-steps.tsx`.
4. Rerun `pnpm shots` for Browse with picks, Settings › General and the first run's project step, in Graphite and Broadsheet, light and dark, at Large text.

Until then, add `.choice-row input { margin: 0; accent-color: var(--accent); }` next to `.choice-row` in `window.css`.
