---
title: Select
status: drifting
group: Inputs
order: 35
classes: select, filter, filters, add-to
summary: The browser's own select, in three places with three boxes: Browse's filters, the picked-items bar's Add to…, and Settings' model pickers.
---

# Select

## What it is

A native `<select>`: pick one value from a list the person doesn't need to see all at once. Oriel has three, each with its own box:

1. **Browse's filters** (`.filter select`): Source, Status, Assignee and Workstream, after the item search. Muted, small text in a `--line` border; once a filter is set, the text and border strengthen (`[data-set]`).
2. **Add to…** (`.add-to`) in Browse's picked-items bar: adds the picked items to a workstream the moment one is chosen, then goes back to "Add to…". It's a menu written as a select.
3. **Settings' model pickers** (`.settings .select`): Default model and Title model, under a field name and an about line.

The browser draws the list itself, so the open list looks like the system's, in every theme. The proposed `Select`, in modern CSS (including a styled list where the browser allows it), is in the [select lab](/lab/select).

## When to use it

- For one value from a list that's too long for radios, or that the server fills: the sources, the people, the models.
- For a filter that narrows a list in place, where the "any" option is the default: "All sources", "Any status", "Anyone".
- Where the options are names a person recognises, not a set they need to compare. To compare, show [radios](/components/checkbox-radio) with an about line.

## When not to

- Not for two to five options a person should see side by side. Those are [radios](/components/checkbox-radio).
- Not for on or off. That's a [switch](/components/switch).
- Not for actions. Add to… is an action dressed as a select, and it's the one exception today; a new set of actions is a [menu](/components/menu).
- Not for a list the person searches. The connector's pick step shows a search field over radio rows instead.

## Anatomy and variants

A select is its `<label>` and the `<select>`. The label is visible in Settings, and visually hidden in Browse's filters, whose "any" option says what each one is.

```html specimen id=browse-filters title="1. Browse's filters, one of them set"
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter-search">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search items</span>
    <input
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search items by key or title"
      maxlength="200"
    />
  </label>
  <label class="filter">
    <span class="visually-hidden">Source</span>
    <select>
      <option value="" selected>All sources</option>
      <option value="jira">Jira</option>
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
  <label class="filter">
    <span class="visually-hidden">Assignee</span>
    <select>
      <option value="" selected>Anyone</option>
      <option value="amara">Amara Okafor</option>
      <option value="greta">Greta Lindqvist</option>
    </select>
  </label>
  <label class="filter">
    <span class="visually-hidden">Workstream</span>
    <select>
      <option value="" selected>In a workstream or not</option>
      <option value="none">Not in a workstream</option>
    </select>
  </label>
  <button type="button" class="quiet-action">Clear filters</button>
</form>
```

```html specimen id=add-to title="2. Add to…, in the picked-items bar, fixed at the foot of a narrow page" width=390 height=150
<div class="shell">
  <div class="selection-bar" role="region" aria-label="Picked items">
    <span class="selection-count">2 picked</span>
    <button type="button" class="button primary">New workstream</button>
    <select class="add-to" aria-label="Add to a workstream">
      <option value="" selected>Add to…</option>
      <option value="ws-1">Checkout v2: phone wallets and saved cards</option>
      <option value="ws-2">Gift cards</option>
    </select>
    <button type="button" class="quiet-action">Clear</button>
  </div>
</div>
```

```html specimen id=settings title="3. Settings › Providers › Models"
<div class="settings">
  <nav class="settings-sections" aria-label="Settings">
    <a class="nav-link" href="/settings" aria-current="page">Providers</a>
    <a class="nav-link" href="/settings/connections">Connections</a>
    <a class="nav-link" href="/settings/general">General</a>
  </nav>
  <div class="settings-body">
    <section class="settings-section" aria-labelledby="settings-models">
      <h2 id="settings-models" class="settings-title">Models</h2>
      <label class="settings-field">
        <span class="settings-field-name">Default model</span>
        <span class="settings-field-about">Runs every thread's turns.</span>
        <select class="select">
          <option value="claude-code claude-opus-5-5" selected>Opus 5.5 · Claude Code</option>
          <option value="claude-code claude-sonnet-5-5">Sonnet 5.5 · Claude Code</option>
          <option value="claude-code claude-haiku-5-5">Haiku 5.5 · Claude Code</option>
        </select>
      </label>
      <label class="settings-field">
        <span class="settings-field-name">Title model</span>
        <span class="settings-field-about">Writes each thread's title from its first message.</span>
        <select class="select">
          <option value="claude-code claude-opus-5-5">Opus 5.5 · Claude Code</option>
          <option value="claude-code claude-sonnet-5-5">Sonnet 5.5 · Claude Code</option>
          <option value="claude-code claude-haiku-5-5" selected>Haiku 5.5 · Claude Code</option>
        </select>
      </label>
    </section>
  </div>
</div>
```

## States

```html specimen id=state-set title="Unset and set: only Browse's filters show a value was picked" state=rest
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter">
    <span class="visually-hidden">Status</span>
    <select>
      <option value="" selected>Any status</option>
      <option value="in-progress">In progress</option>
    </select>
  </label>
  <label class="filter">
    <span class="visually-hidden">Status</span>
    <select data-set>
      <option value="">Any status</option>
      <option value="in-progress" selected>In progress</option>
    </select>
  </label>
</form>
```

```html specimen id=state-focus title="Focus visible: the global ring, 2px out, in Browse" state=focus-visible
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter">
    <span class="visually-hidden">Assignee</span>
    <select class="ws-focus-visible">
      <option value="" selected>Anyone</option>
      <option value="amara">Amara Okafor</option>
    </select>
  </label>
  <select class="add-to ws-focus-visible" aria-label="Add to a workstream">
    <option value="" selected>Add to…</option>
    <option value="ws-2">Gift cards</option>
  </select>
</form>
```

```html specimen id=state-focus-settings title="Focus visible in Settings: the ring on the border (outline-offset: 0)" state=focus-visible width=390
<div class="settings">
  <div class="settings-body">
    <label class="settings-field">
      <span class="settings-field-name">Default model</span>
      <span class="settings-field-about">Runs every thread's turns.</span>
      <select class="select ws-focus-visible">
        <option value="claude-code claude-opus-5-5" selected>Opus 5.5 · Claude Code</option>
        <option value="claude-code claude-sonnet-5-5">Sonnet 5.5 · Claude Code</option>
      </select>
    </label>
  </div>
</div>
```

```html specimen id=state-disabled title="Disabled: no models yet, and the about line says why" state=disabled width=390
<div class="settings">
  <div class="settings-body">
    <label class="settings-field">
      <span class="settings-field-name">Default model</span>
      <span class="settings-field-about">Turn on a provider that's ready to pick one.</span>
      <select class="select" disabled>
        <option value="" selected>None</option>
      </select>
    </label>
  </div>
</div>
```

- **Rest:** a bordered box on `--surface`, with the browser's own arrow.
- **Set:** only Browse's filters have it. `[data-set]` changes the border from `--line` to `--line-strong` and the text from `--text-muted` to `--text` (`.filter select[data-set]` in `window.css`), so a filter that narrows the list stands out from those that don't. It's the only "has a value" state of any control in Oriel.
- **Hover, active:** not styled.
- **Focus visible:** the global ring, 2px out, in Browse (`:focus-visible` in `window.css`). Settings draws it at 0 offset, on the border (`.settings :is(.input, .select):focus-visible` in `window.css`).
- **Disabled:** not styled; the browser's own. Settings disables a model picker when no provider is ready and says so in the about line. Add to… is disabled while the picked items are being added.
- **Busy, error:** shown beside the select, not on it. A failed add shows in the bar's `.selection-notice`; a refused model shows `.settings-problem` at the top of Settings.
- **Empty:** a model picker with no current model offers "None" first. Add to… shows only when there are other workstreams and something is picked.

## Keyboard and ARIA

- Native, so it's in the tab order; Space or Alt+Down opens the list, the arrow keys move, and typing jumps to an option. On macOS, the arrow keys open the list rather than change the value.
- Its accessible name comes from its `<label>`: visible in Settings, a `.visually-hidden` span in Browse's filters. Add to… has only `aria-label="Add to a workstream"`.
- Browse's filters act on change, so moving through the options with the arrow keys on Windows filters at each step. Add to… acts on change too: picking a workstream adds the items at once, with no confirm.
- The filters sit in a `<form role="search" aria-label="Filter items">`.
- Settings' about line is inside the `<label>`, so it's read as part of the select's name.

## Content

- An "any" option first, saying what the filter is about: "All sources", "Any status", "Anyone", "In a workstream or not". It's the label people see, since the real label is hidden.
- Option names are the names people use: a person's name, a workstream's name, "To do", "In progress", "Done".
- A select that acts ends in "…": "Add to…".
- Models read "{model} · {provider}": "Opus 5.5 · Claude Code".

## Where the app uses it

- Browse's filters, selects included: `Filters` in `packages/web/src/window-page.tsx`. CSS `.filters`, `.filter select` and `.filter select[data-set]` in `window.css`.
- Add to…: `Selection` in `packages/web/src/window-page.tsx`. CSS `.add-to` in `window.css`.
- Model pickers: `ModelPicker` in `packages/web/src/settings-page.tsx`, used by `Providers` for Default model and Title model. CSS `.settings :is(.input, .select)`, `.settings :is(.input, .select):focus-visible` and `.settings-field .select` in `window.css`.

## Drift

Status **drifting**: one control, three boxes.

|        | Browse filter                         | Add to…                     | Settings                       |
| ------ | ------------------------------------- | --------------------------- | ------------------------------ |
| Height | 1.875rem                              | none set; 0.1875rem padding | 1.875rem                       |
| Border | `--line`, `--line-strong` when set    | `--line-strong`             | `--line-strong`                |
| Text   | `--text-sm`, muted; `--text` when set | `--text-sm`                 | inherited (`--text-md`)        |
| Focus  | global ring, 2px out                  | global ring, 2px out        | ring at 0 offset               |
| Label  | visually hidden                       | `aria-label` only           | visible, with an about line    |
| Class  | none: styled by `.filter select`      | `.add-to`                   | `.select`, only in `.settings` |

`.select` has no rule of its own outside `.settings`, so it can't be reused anywhere else as it is. Add to… is a menu made of a select because Browse's context menu has no visible opener.

**Until a Select component lands, copy Browse's filter**: a `<label class="filter">` around a bare `<select>`, with `data-set` when it holds a value. Inside Settings, use `.select` as Settings does. Don't copy `.add-to` for a new action list; use a [menu](/components/menu). The [drift report](/drift) has the proposal, and the [lab](/lab/select) shows it in modern CSS.
