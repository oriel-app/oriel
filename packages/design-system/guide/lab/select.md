---
title: Select
status: proposed
order: 10
classes: dropdown, dropdown-dot, dropdown-text, dropdown-label, dropdown-about, dropdown-count, filter, filters, add-to, select, settings, settings-field, settings-field-name, settings-field-about, visually-hidden
summary: One select for Browse's filters, "Add to…" and the model pickers, as a customizable select (appearance base-select) in Oriel's own picker, with a native fallback.
---

# Select

## What it is

A select picks one value from a short, fixed list. Oriel has three, each styled on its own:

1. **Browse's filters**: source, status, assignee and workstream. "Any status" until one is set.
2. **"Add to…"** in the picked-items bar. It acts on change, then goes back to "Add to…", so it works as a menu.
3. **Settings' model pickers**: "Default model" and "Title model".

All three are native selects today, so the list that opens is the system's: its font, its colours, its corners, whatever the theme. The proposal is one class, `.dropdown`, in two layers:

- **Every engine:** a native select that looks like Oriel's fields. One border, one radius, one height, and the field focus (the border and a ring in `--focus`).
- **Where the engine has it:** the customizable select. `appearance: base-select` on the select and on its `::picker(select)` makes the list Oriel's own, drawn like the context menu, in the theme. An option can hold more than words: a state dot, a count, a line about the choice.

The control stays a real `<select>`. Its keyboard, its form value, its accessibility and its top-layer list are the browser's. Nothing here needs JavaScript.

## Today

The three selects as the app renders them, with Oriel's CSS. Click one: the list that opens is the operating system's, not Oriel's.

```html specimen id=today-filter title="Browse's filters (Filters, in window-page.tsx)" side=today height=220
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter">
    <span class="visually-hidden">Source</span>
    <select>
      <option value="" selected>All sources</option>
      <option value="jira">Payments Jira</option>
      <option value="slack">Slack</option>
    </select>
  </label>
  <label class="filter">
    <span class="visually-hidden">Status</span>
    <select data-set>
      <option value="">Any status</option>
      <option value="todo">To do</option>
      <option value="in-progress" selected>In progress</option>
      <option value="done">Done</option>
    </select>
  </label>
</form>
```

```html specimen id=proposed-filter title="The filters as a .dropdown: dots by status, quiet until set" side=proposed height=220
<form class="filters" role="search" aria-label="Filter items">
  <label>
    <span class="visually-hidden">Source</span>
    <select class="dropdown" data-quiet>
      <button><selectedcontent></selectedcontent></button>
      <option value="" selected>All sources</option>
      <option value="jira">Payments Jira</option>
      <option value="slack">Slack</option>
    </select>
  </label>
  <label>
    <span class="visually-hidden">Status</span>
    <select class="dropdown" data-quiet>
      <button><selectedcontent></selectedcontent></button>
      <option value="">Any status</option>
      <option value="todo"><span class="dropdown-dot" data-category="todo"></span>To do</option>
      <option value="in-progress" selected>
        <span class="dropdown-dot" data-category="in-progress"></span>In progress
      </option>
      <option value="done"><span class="dropdown-dot" data-category="done"></span>Done</option>
    </select>
  </label>
</form>
```

```html specimen id=today-add-to title="Add to…, in the picked-items bar (Selection, in window-page.tsx)" side=today height=200
<select class="add-to" aria-label="Add to a workstream">
  <option value="" selected>Add to…</option>
  <option value="gift-cards">Gift cards</option>
  <option value="vehicle">Vehicle and freight reservations</option>
  <option value="sms">SMS updates</option>
</select>
```

```html specimen id=proposed-add-to title="Add to… as a .dropdown, with each workstream's count" side=proposed height=200
<select class="dropdown" aria-label="Add to a workstream">
  <button><selectedcontent></selectedcontent></button>
  <option value="" selected>Add to…</option>
  <option value="gift-cards">
    <span class="dropdown-label">Gift cards</span>
    <span class="dropdown-count">4 items</span>
  </option>
  <option value="vehicle">
    <span class="dropdown-label">Vehicle and freight reservations</span>
    <span class="dropdown-count">11 items</span>
  </option>
  <option value="sms">
    <span class="dropdown-label">SMS updates</span>
    <span class="dropdown-count">3 items</span>
  </option>
</select>
```

```html specimen id=today-model title="Settings' model picker (ModelPicker, in settings-page.tsx)" side=today height=220
<div class="settings">
  <label class="settings-field">
    <span class="settings-field-name">Default model</span>
    <span class="settings-field-about">Runs every thread's turns.</span>
    <select class="select">
      <option value="claude-code claude-opus-5-5" selected>Opus 5.5 · Claude Code</option>
      <option value="claude-code claude-sonnet-5-5">Sonnet 5.5 · Claude Code</option>
      <option value="claude-code claude-haiku-5-5">Haiku 5.5 · Claude Code</option>
    </select>
  </label>
</div>
```

```html specimen id=proposed-model title="The model picker as a .dropdown, a line about each model" side=proposed height=260
<div class="settings">
  <label class="settings-field">
    <span class="settings-field-name">Default model</span>
    <span class="settings-field-about">Runs every thread's turns.</span>
    <select class="dropdown">
      <button><selectedcontent></selectedcontent></button>
      <option value="claude-code claude-opus-5-5" selected>
        <span class="dropdown-text"
          ><span class="dropdown-label">Opus 5.5 · Claude Code</span>
          <span class="dropdown-about">The largest. Oriel's default for turns.</span></span
        >
      </option>
      <option value="claude-code claude-sonnet-5-5">
        <span class="dropdown-text"
          ><span class="dropdown-label">Sonnet 5.5 · Claude Code</span>
          <span class="dropdown-about">Between the two.</span></span
        >
      </option>
      <option value="claude-code claude-haiku-5-5">
        <span class="dropdown-text"
          ><span class="dropdown-label">Haiku 5.5 · Claude Code</span
          ><span class="dropdown-about"
            >The smallest and quickest. Oriel's default for titles.</span
          ></span
        >
      </option>
    </select>
  </label>
</div>
```

What differs today:

|               | Browse filter                    | "Add to…"                 | Model picker                                                                   |
| ------------- | -------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Height        | 1.875rem                         | unset, 0.1875rem padding  | 1.875rem                                                                       |
| Border        | `--line`, `--line-strong` if set | `--line-strong`           | `--line-strong`                                                                |
| Text          | `--text-sm`, muted until set     | `--text-sm`               | the body's `--text-md`                                                         |
| Focus         | the window's 2px outline         | the window's 2px outline  | the 2px outline, offset 0                                                      |
| Disabled      | not styled                       | not styled                | not styled (the browser's grey)                                                |
| The open list | the system's                     | the system's              | the system's                                                                   |
| CSS           | `.filter select` in `window.css` | `.add-to` in `window.css` | `.settings :is(.input, .select)` and `.settings-field .select` in `window.css` |

## Proposed

The markup is a `<select class="dropdown">` with two additions inside it, which an engine without the customizable select ignores:

- `<button><selectedcontent></selectedcontent></button>` first. The browser copies the chosen option's content into `<selectedcontent>`, so the button shows its dot and its name. The proposal hides the option's count and its line about it there.
- Rich content inside an `<option>`: `.dropdown-dot`, `.dropdown-label`, `.dropdown-count`, `.dropdown-text` and `.dropdown-about`. Keep the option's own text a whole name ("In progress", "Gift cards"): it is what type-ahead matches, what a screen reader reads, and what an older engine shows.

Don't give a rich option a `label` attribute. In Chrome 156 an option's `label` replaces its content in the open list, so the dot, the count and the line all disappear.

```html specimen id=anatomy title="Anatomy: closed, the button shows the chosen option's dot and name" height=220
<label>
  <span class="visually-hidden">Status</span>
  <select class="dropdown" data-quiet>
    <button><selectedcontent></selectedcontent></button>
    <option value="">Any status</option>
    <option value="todo"><span class="dropdown-dot" data-category="todo"></span>To do</option>
    <option value="in-progress" selected>
      <span class="dropdown-dot" data-category="in-progress"></span>In progress
    </option>
    <option value="done"><span class="dropdown-dot" data-category="done"></span>Done</option>
  </select>
</label>
```

### The open list

A select's list can't be forced open in a picture: `:open` matches only when a person opens it. Every proposed specimen on this page has room under it, so click one (or focus it and press Space) to see the real list, in the theme you're viewing. These two are here for that.

```html specimen id=open-workstreams title="Open me: a disabled option among the workstreams" side=proposed height=240
<select class="dropdown" aria-label="Add to a workstream">
  <button><selectedcontent></selectedcontent></button>
  <option value="" selected>Add to…</option>
  <option value="gift-cards">
    <span class="dropdown-label">Gift cards</span>
    <span class="dropdown-count">4 items</span>
  </option>
  <option value="vehicle">
    <span class="dropdown-label">Vehicle and freight reservations</span>
    <span class="dropdown-count">11 items</span>
  </option>
  <option value="sms" disabled>
    <span class="dropdown-label">SMS updates</span>
    <span class="dropdown-count">3 items</span>
  </option>
</select>
```

```html specimen id=open-models title="Open me: models, with a line about each" side=proposed height=280
<select class="dropdown" aria-label="Default model">
  <button><selectedcontent></selectedcontent></button>
  <option value="claude-code claude-opus-5-5" selected>
    <span class="dropdown-text"
      ><span class="dropdown-label">Opus 5.5 · Claude Code</span>
      <span class="dropdown-about">The largest. Oriel's default for turns.</span></span
    >
  </option>
  <option value="claude-code claude-sonnet-5-5">
    <span class="dropdown-text"
      ><span class="dropdown-label">Sonnet 5.5 · Claude Code</span>
      <span class="dropdown-about">Between the two.</span></span
    >
  </option>
  <option value="claude-code claude-haiku-5-5">
    <span class="dropdown-text"
      ><span class="dropdown-label">Haiku 5.5 · Claude Code</span
      ><span class="dropdown-about"
        >The smallest and quickest. Oriel's default for titles.</span
      ></span
    >
  </option>
</select>
```

Open, the list is the context menu's frame: `--surface`, a `--line` border, `--radius-lg` and `--shadow`, `--space-1` inside. It sits under the select, at least as wide as it, and flips above when the window has no room below (the browser's own anchor positioning; nothing is placed by script). It fades in over `--duration-quick`.

To show the options' states without opening anything, the specimens below use the same `.dropdown` in **listbox mode** (`size="4"`): a real select whose options sit in the page, in the list's frame. The option rules are the same ones the open list uses; the hovered option is forced with `ws-hover`. Listbox mode is for this page only: none of Oriel's selects should become one.

```html specimen id=options-workstreams title="Options: rest, hover (forced), chosen with its tick, disabled" side=proposed
<select class="dropdown" size="4" aria-label="Add to a workstream (listbox)">
  <option value="">Add to…</option>
  <option value="gift-cards" class="ws-hover">
    <span class="dropdown-label">Gift cards</span>
    <span class="dropdown-count">4 items</span>
  </option>
  <option value="vehicle" selected>
    <span class="dropdown-label">Vehicle and freight reservations</span>
    <span class="dropdown-count">11 items</span>
  </option>
  <option value="sms" disabled>
    <span class="dropdown-label">SMS updates</span>
    <span class="dropdown-count">3 items</span>
  </option>
</select>
```

```html specimen id=options-status title="Options: the status filter's dots" side=proposed
<select class="dropdown" size="4" aria-label="Status (listbox)">
  <option value="">Any status</option>
  <option value="todo"><span class="dropdown-dot" data-category="todo"></span>To do</option>
  <option value="in-progress" selected>
    <span class="dropdown-dot" data-category="in-progress"></span>In progress
  </option>
  <option value="done" class="ws-hover">
    <span class="dropdown-dot" data-category="done"></span>Done
  </option>
</select>
```

## States

The select's own states are forced below with `ws-` classes, which carry the proposal's own `:hover` and `:focus-visible` rules. Today's are beside them.

```html specimen id=today-states title="Today: rest, hover and focus-visible" side=today
<div class="ws-row">
  <select class="add-to" aria-label="Add to a workstream (rest)">
    <option>Add to…</option>
  </select>
  <select class="add-to ws-hover" aria-label="Add to a workstream (hover)">
    <option>Add to…</option>
  </select>
  <select class="add-to ws-focus-visible" aria-label="Add to a workstream (focus)">
    <option>Add to…</option>
  </select>
</div>
```

```html specimen id=proposed-states title="Proposed: rest, hover and focus-visible" side=proposed
<div class="ws-row">
  <select class="dropdown" aria-label="Add to a workstream (rest)">
    <button><selectedcontent></selectedcontent></button>
    <option>Add to…</option>
  </select>
  <select class="dropdown ws-hover" aria-label="Add to a workstream (hover)">
    <button><selectedcontent></selectedcontent></button>
    <option>Add to…</option>
  </select>
  <select class="dropdown ws-focus-visible" aria-label="Add to a workstream (focus)">
    <button><selectedcontent></selectedcontent></button>
    <option>Add to…</option>
  </select>
</div>
```

```html specimen id=today-set title="Today: a filter, unset and set" side=today
<div class="ws-row">
  <label class="filter">
    <span class="visually-hidden">Assignee</span>
    <select>
      <option value="" selected>Anyone</option>
      <option value="amara">Amara Okafor</option>
    </select>
  </label>
  <label class="filter">
    <span class="visually-hidden">Assignee, set</span>
    <select data-set>
      <option value="">Anyone</option>
      <option value="amara" selected>Amara Okafor</option>
    </select>
  </label>
</div>
```

```html specimen id=proposed-set title="Proposed: unset and set, read from the chosen option" side=proposed
<div class="ws-row">
  <label>
    <span class="visually-hidden">Assignee</span>
    <select class="dropdown" data-quiet>
      <button><selectedcontent></selectedcontent></button>
      <option value="" selected>Anyone</option>
      <option value="amara">Amara Okafor</option>
    </select>
  </label>
  <label>
    <span class="visually-hidden">Assignee, set</span>
    <select class="dropdown" data-quiet>
      <button><selectedcontent></selectedcontent></button>
      <option value="">Anyone</option>
      <option value="amara" selected>Amara Okafor</option>
    </select>
  </label>
</div>
```

```html specimen id=today-disabled title="Today: disabled, with no model to pick" side=today
<div class="settings">
  <label class="settings-field">
    <span class="settings-field-name">Title model</span>
    <span class="settings-field-about">Turn on a provider that's ready to pick one.</span>
    <select class="select" disabled>
      <option value="">None</option>
    </select>
  </label>
</div>
```

```html specimen id=proposed-disabled title="Proposed: disabled, at half strength like a button" side=proposed
<div class="settings">
  <label class="settings-field">
    <span class="settings-field-name">Title model</span>
    <span class="settings-field-about">Turn on a provider that's ready to pick one.</span>
    <select class="dropdown" disabled>
      <button><selectedcontent></selectedcontent></button>
      <option value="">None</option>
    </select>
  </label>
</div>
```

```html specimen id=proposed-invalid title="Proposed: a required choice left empty (aria-invalid, or :user-invalid once touched)" side=proposed height=200
<div class="settings">
  <label class="settings-field">
    <span class="settings-field-name">Default model</span>
    <span class="settings-field-about" id="model-problem">Pick a model before you ask.</span>
    <select class="dropdown" required aria-invalid="true" aria-describedby="model-problem">
      <button><selectedcontent></selectedcontent></button>
      <option value="" selected>None</option>
      <option value="claude-code claude-opus-5-5">Opus 5.5 · Claude Code</option>
    </select>
  </label>
</div>
```

- **Rest:** `--line-strong` border, `--surface`, `--text-sm`, 1.875rem high, `--radius`. A `data-quiet` select (Browse's filters) has a `--line` border and muted text while its empty "any" option is chosen, read with `:has(option[value=""]:checked)`, so `data-set` isn't needed.
- **Hover:** `--surface-hover`, as a button.
- **Focus-visible:** the field focus: the border and a 1px ring in `--focus`, the same as the sidebar's search and the proposed ChatInput. A click doesn't show it; the keyboard does.
- **Open:** the list in the top layer, under the select or over it where there's no room below, fading in over `--duration-quick` (`@starting-style`). The chevron turns up. Real only; see [The open list](#the-open-list).
- **Option hover and keyboard focus:** `--surface-hover`, as a context menu item.
- **Option chosen:** medium weight, and the tick (`option::checkmark`) in `--accent` at the end.
- **Option disabled:** half strength; it can't be chosen, and the arrow keys skip it.
- **Disabled select:** half strength, like a disabled button. Today the three selects get the browser's grey.
- **Error:** a `--danger` border, from `aria-invalid="true"` or `:user-invalid` (a `required` select left on its empty option, after the person has touched it). None of Oriel's selects can be wrong today; a filter or a menu has no wrong answer. The state is here so a required select in a form matches the [text field](/lab/text-field).
- **Busy, empty:** not states of a select. Disable it while what it acts on is busy, as "Add to…" is while a change is pending.
- **Themes:** the radius is `--radius` and the list's is `--radius-lg`, so Broadsheet's corners go square. The colours are the theme's tokens, light and dark.

## Keyboard and ARIA

The keyboard is the native select's, in both layers. Nothing is scripted.

- **Tab** reaches the select; the `<button>` inside it isn't a second tab stop.
- **Space**, **Alt+Down** or **Alt+Up** open the list; on macOS, **Up** and **Down** open it too. **Enter** doesn't open it on macOS (tried in Chrome 156); on Windows it's **F4** or Alt+Down, as for any select. Focus moves to the chosen option.
- **Up** and **Down** move between options, skipping disabled ones. **Home** and **End** go to the first and last.
- **Typing** jumps to the option whose text starts with what's typed (type-ahead), on the option's text: "In progress", "Gift cards 4 items". On a closed select it picks that option at once, without opening: typing "g" on "Add to…" picks Gift cards, and "Add to…" acts on change. That's true of today's native select too; keep the reducer's guard that nothing is added while a change is pending.
- **Enter** or **Space** picks the focused option and closes the list; **Escape** closes it without picking. A click outside closes it too (it's a light-dismiss popover).

ARIA comes with the element:

- The select is a `combobox` with a popup; its name is its `<label>` or `aria-label` ("Status", "Add to a workstream", "Default model"). Browse's labels are visually hidden, as today.
- An option's accessible name is all its text, so a model is read "Opus 5.5 · Claude Code The largest. Oriel's default for turns." Keep the line about it short, and put the name first.
- Dots and ticks are decoration. A dot must never be the only thing that says the status: the name is beside it.
- A problem is tied to the select with `aria-describedby`, as in the error specimen, and the select gets `aria-invalid="true"`.

"Add to…" acts on change and resets, so it's a menu wearing a select. It's still the right element here: one choice from a list of workstreams, with the select's keyboard. If it ever needs actions that aren't workstreams ("New workstream…"), it becomes a [menu](/components/menu).

## Support and fallback

| Feature                                                | Chromium | Desktop (Chromium 156) | Safari / Firefox                 | Fallback                                                                                            |
| ------------------------------------------------------ | -------- | ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `appearance: base-select`, `::picker(select)`          | 135      | Yes                    | Safari 27; Firefox behind a flag | Layer one: a native select with Oriel's border, radius, padding and focus. The list is the system's |
| `<button>` and `<selectedcontent>` in a select         | 135      | Yes                    | Safari 27; Firefox no            | The old parser drops both, and the native select shows the chosen option's text                     |
| Rich content in `<option>`                             | 135      | Yes                    | Safari 27; Firefox no            | The old parser drops the elements and keeps their text: "Gift cards 4 items"                        |
| `::picker-icon`, `option::checkmark`, `:open`          | 135      | Yes                    | Safari 27; Firefox no            | The system's arrow and tick. All three sit inside `@supports`, so no selector list is lost          |
| `@starting-style` and `allow-discrete` on the list     | 117      | Yes                    | Safari 17.5, Firefox 129         | The list opens without a fade                                                                       |
| `:has(option[value=""]:checked)` for "quiet until set" | 105      | Yes                    | Safari 15.4, Firefox 121         | Always the set look                                                                                 |
| `:user-invalid`                                        | 119      | Yes                    | Safari 16.5, Firefox 88          | `[aria-invalid]` (inside `:is()`, which forgives an unknown pseudo-class)                           |

No select is on the review link page, the one page that may open in Safari or Firefox. The fallback matters for `pnpm dev` in another browser, and for the day a select reaches a shared page.

What was tried:

- **Chrome 156, headless** (the same major as Electron 45): `CSS.supports("appearance: base-select")` is true. A click opens the list and `:open` matches; Tab then Space opens it from the keyboard, Down moves to the next option, Enter picks it, and `<selectedcontent>` copies its markup. Screenshots of the open list, in Graphite light and Broadsheet dark, match the listbox specimens above.
- **Firefox 142, headless** (no base-select): every select falls back to a native one with Oriel's border, radius, padding and focus, the quiet filter is muted, and the dots are gone. The model picker's closed select reads "Opus 5.5 · Claude Code The largest. Oriel's default for turns.": the old parser keeps the line about the model as text. That's why the markup leaves a space between the name and the line, and why the line must make sense read straight after the name.
- **Safari** wasn't run here. Safari 27 has the dropdown (not listbox mode), so it should match Chrome's open list; check it before the review page ever gets a select.

## Adopt now or wait

**Adopt now** for the window. Every engine Oriel's window runs in has the customizable select, and the fallback is the native select it has today, better dressed. The three selects become one class, the open list wears the theme, and Browse's status filter can show the state dots the rows use.

Two cautions. Keep each option's text a whole name, because type-ahead, a screen reader and an older engine all use it. And a base-select sizes to what's chosen, so a filter grows a little when "Any status" becomes "In progress"; give the Browse filters a `min-width` if that jump bothers anyone.

## How to migrate

1. Add `select.css`'s rules to `window.css`, after the field rules, which end with `.input[aria-invalid]` in `window.css`.
2. Browse's filters, `Filters` in `packages/web/src/window-page.tsx`: `<select class="dropdown" data-quiet>`, with `<button><selectedcontent></selectedcontent></button>` first. Drop `data-set`; the quiet look reads the chosen option. For the status filter, put `<span class="dropdown-dot" data-category={id} />` before each name. The `<label class="filter">` can stay for the hidden name, but delete `.filter select` and `.filter select[data-set]` (`.filter select` and `.filter select[data-set]` in `window.css`), or they outrank `.dropdown`.
3. "Add to…", `Selection` in `packages/web/src/window-page.tsx`: `class="dropdown"`, the button, and each workstream's item count in a `.dropdown-count` (`WorkstreamSummary` has the members). Delete `.add-to` in `window.css`.
4. Settings, the select that `ModelPicker` in `packages/web/src/settings-page.tsx` draws: `class="dropdown"`, and a line about each model if the server sends one. Remove `.select` from `.settings :is(.input, .select)` and `.settings :is(.input, .select):focus-visible` in `window.css`, and delete `.settings-field .select` in `window.css`.
5. Shots to retake: Browse with filters set, the picked-items bar, Settings › Models, in each theme.
