---
title: Checkbox and radio
status: drifting
group: Inputs
order: 40
classes: pick, anchor-pick, choices, choice
summary: Native checkboxes to pick items in Browse, and native radios to pick one of a few, as a plain list in Settings or as framed rows in a connector's steps.
---

# Checkbox and radio

## What it is

Oriel uses the browser's own checkbox and radio, tinted with `accent-color: var(--accent)`. It draws no box or dot of its own. There are two shapes:

- **The pick checkbox** (`.pick`): picks an item in Browse, to make a workstream of it or add it to one. A cluster's epic gets one too (`.pick.anchor-pick`), which picks the epic itself, not its items. "The checkbox waits until the row is pointed at, or something is picked" (`.pick` in `window.css`). These are the only checkboxes in the app.
- **The radio list** (`.choices` of `.choice`): a setting picked from a few, as radio buttons, under a field's name and an optional about line. Settings › General, Appearance and Asking use it, and so does each connection's "How often it syncs".

The proposed versions of these controls, in modern CSS, are in the [checkbox and radio lab](/lab/checkbox-radio).

## When to use it

- **A pick checkbox** for picking rows out of a long list so an action can apply to all of them: Browse's picked-items bar then offers New workstream, Add to… and Clear.
- **A radio list** for one setting with two to six named options that are short enough to read in one line each: "Relative, such as 3 min ago" or "Date and time, such as Nov 3, 09:41".
- A radio setting applies as soon as it's picked, with no Save. Settings writes it at once.

## When not to

- Not a checkbox for one on/off setting. That's a [switch](/components/switch): "Notify me when a thread needs me".
- Not radios to switch between views of the same thing, such as Browse's grouping. Those are [tabs](/components/tabs), buttons with `aria-pressed`.
- Not radios for a long list the server pages in. A pick through a source server adds a search field above the radios once there are more than fit; past that, use a [select](/components/select).
- Not a home-made dot. The first run's `.cli-picked` in `window.css` looks like a radio but is a `role="img"` labelled "Picked" whether or not it is. Don't copy it for anything a person picks.

## Anatomy and variants

### The pick checkbox, in Browse

The checkbox sits in its own 1.25rem column at the row's start, in a `<label class="pick">` the size of the cell. It has no visible label: its accessible name is "Pick {title}". A picked row is tinted `--accent-soft` (`.item.picked`, and `.cluster-head.picked` for an epic).

```html specimen id=pick-browse title="Browse, picking: every checkbox shows once one item is picked"
<div class="clusters" data-anchored data-picking>
  <section class="cluster" data-open>
    <h2 class="cluster-head">
      <label class="pick anchor-pick" title="Pick SYN-1 itself, not its items">
        <input type="checkbox" aria-label="Pick Checkout v2: phone wallets and saved cards" />
      </label>
      <button type="button" class="cluster-toggle" aria-expanded="true" aria-controls="items-syn-1">
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name">
          <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
          <span class="key">SYN-1</span>
        </span>
        <span class="cluster-details">
          <span class="cluster-meta"><span class="count">3 items</span></span>
        </span>
      </button>
    </h2>
    <ul class="items" id="items-syn-1">
      <li class="item picked">
        <label class="pick">
          <input type="checkbox" checked aria-label="Pick Pay with a phone wallet on the website" />
        </label>
        <a
          class="key source-link"
          href="https://example.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="story" title="Story"></span>SYN-23</a
        >
        <span class="title" title="Pay with a phone wallet on the website"
          >Pay with a phone wallet on the website</span
        >
        <span class="status" data-category="in-progress">In progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points" title="3 points">3</span>
        <span class="idle" title="Updated 2 days ago">2d</span>
      </li>
      <li class="item">
        <label class="pick">
          <input type="checkbox" aria-label="Pick Update the payment declined error message" />
        </label>
        <a
          class="key source-link"
          href="https://example.atlassian.net/browse/SYN-8"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="bug" title="Bug"></span>SYN-8</a
        >
        <span class="title" title="Update the payment declined error message"
          >Update the payment declined error message</span
        >
        <span class="status" data-category="todo">To do</span>
        <span class="assignee none"><span class="avatar" aria-hidden="true"></span>Unassigned</span>
        <span class="points" title="1 point">1</span>
        <span class="idle" title="Updated today">today</span>
      </li>
      <li class="item">
        <label class="pick">
          <input type="checkbox" aria-label="Pick Remove the legacy web-view checkout" />
        </label>
        <a
          class="key source-link"
          href="https://example.atlassian.net/browse/SYN-10"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="task" title="Task"></span>SYN-10</a
        >
        <span class="title" title="Remove the legacy web-view checkout"
          >Remove the legacy web-view checkout</span
        >
        <span class="status" data-category="todo">To do</span>
        <span class="assignee"
          ><span class="avatar" aria-hidden="true">GL</span>Greta Lindqvist</span
        >
        <span class="points" title="Unestimated">–</span>
        <span class="idle" title="Updated 9 days ago">9d</span>
      </li>
    </ul>
  </section>
</div>
```

### The radio list, in Settings

A `<fieldset class="settings-field">` whose `<legend class="settings-field-name">` names the setting, then its optional about line, then one `<label class="choice">` per option with the radio first. The radios share a `name`, `settings-{name}` by default.

```html specimen id=choices title="A radio list: Settings › General, Times"
<fieldset class="settings-field">
  <legend class="settings-field-name">Times</legend>
  <span class="settings-field-about"
    >How Oriel writes when something happened, everywhere but a review link's page.</span
  >
  <div class="choices">
    <label class="choice"
      ><input type="radio" name="settings-times" value="relative" checked />Relative, such as 3 min
      ago</label
    >
    <label class="choice"
      ><input type="radio" name="settings-times" value="absolute" />Date and time, such as Nov 3,
      09:41</label
    >
  </div>
</fieldset>
```

What a person picks on a connection through its source server, such as its Jira project, is the same list under a "Change" button, showing what the server reads as picked, with each option written "{name} ({value})". A search field joins it when there are more options than it shows.

```html specimen id=choices-option title="A connection's option, listed after Change (Settings › Connections)"
<fieldset class="settings-field">
  <legend class="settings-field-name">Project</legend>
  <span class="settings-field-about">SYN </span>
  <div class="choices">
    <label class="choice"
      ><input type="radio" name="connection-jira-1-project" value="SYN" checked />Synthetic
      (SYN)</label
    >
    <label class="choice"
      ><input type="radio" name="connection-jira-1-project" value="OPS" />Operations (OPS)</label
    >
    <label class="choice"
      ><input type="radio" name="connection-jira-1-project" value="WEB" />Website (WEB)</label
    >
  </div>
</fieldset>
```

## States

```html specimen id=pick-rest title="Rest: nothing picked, so the checkboxes wait" state=rest
<div class="clusters">
  <section class="cluster" data-open>
    <ul class="items">
      <li class="item">
        <label class="pick">
          <input type="checkbox" aria-label="Pick Pay with a phone wallet on the website" />
        </label>
        <span class="key"><span class="type" data-type="story" title="Story"></span>SYN-23</span>
        <span class="title">Pay with a phone wallet on the website</span>
        <span class="status" data-category="in-progress">In progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points">3</span>
        <span class="idle">2d</span>
      </li>
    </ul>
  </section>
</div>
```

```html specimen id=pick-hover title="Hover: the row's checkbox shows" state=hover
<div class="clusters">
  <section class="cluster" data-open>
    <ul class="items">
      <li class="item ws-hover">
        <label class="pick">
          <input type="checkbox" aria-label="Pick Pay with a phone wallet on the website" />
        </label>
        <span class="key"><span class="type" data-type="story" title="Story"></span>SYN-23</span>
        <span class="title">Pay with a phone wallet on the website</span>
        <span class="status" data-category="in-progress">In progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points">3</span>
        <span class="idle">2d</span>
      </li>
    </ul>
  </section>
</div>
```

```html specimen id=pick-focus title="Focus visible: the checkbox shows, with the ring" state=focus-visible
<div class="clusters">
  <section class="cluster" data-open>
    <ul class="items">
      <li class="item">
        <label class="pick ws-focus-within">
          <input
            type="checkbox"
            class="ws-focus-visible"
            aria-label="Pick Pay with a phone wallet on the website"
          />
        </label>
        <span class="key"><span class="type" data-type="story" title="Story"></span>SYN-23</span>
        <span class="title">Pay with a phone wallet on the website</span>
        <span class="status" data-category="in-progress">In progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points">3</span>
        <span class="idle">2d</span>
      </li>
    </ul>
  </section>
</div>
```

```html specimen id=radio-focus title="Focus visible on a radio" state=focus-visible
<div class="ws-stack">
  <div class="choices">
    <label class="choice"><input type="radio" name="focus-text-size" value="small" />Small</label>
    <label class="choice"
      ><input
        type="radio"
        name="focus-text-size"
        value="default"
        class="ws-focus-visible"
        checked
      />Default</label
    >
    <label class="choice"><input type="radio" name="focus-text-size" value="large" />Large</label>
  </div>
</div>
```

```html specimen id=radio-disabled title="Disabled: the browser's own look, while a pick is saving" state=disabled
<div class="choices">
  <label class="choice"
    ><input type="radio" name="disabled-project" value="SYN" checked disabled />Synthetic
    (SYN)</label
  >
  <label class="choice"
    ><input type="radio" name="disabled-project" value="OPS" disabled />Operations (OPS)</label
  >
</div>
```

- **Rest:** a pick checkbox is invisible (`opacity: 0`) until its row is hovered, it has focus, or anything in the list is picked (`[data-picking]` on `.clusters`). On a touch screen, with no hover, it's always at 0.7 (`@media (hover: none)` in `window.css`). Radios always show.
- **Hover:** shows a row's checkbox, and the cluster head's (`.cluster-head:hover .pick` in `window.css`). Hovering the epic's checkbox tints its heading (`.anchor-pick:hover + .cluster-toggle` in `window.css`). Radios have no hover of their own; the label is `cursor: pointer`.
- **Focus visible:** the global ring, 2px out (`:focus-visible` in `window.css`). `.pick:focus-within` makes the checkbox show while it has focus.
- **Checked:** the browser's own mark in `--accent`. A picked item's row is tinted. A `.choice` radio's label doesn't change.
- **Disabled:** not styled; the browser's own. A connection's option radios are disabled while a change saves. Pick checkboxes are never disabled.
- **Active, error, busy:** not styled. A failed pick shows in the picked-items bar's `.selection-notice`; a failed change to a connection's option shows `.connection-problem` beside it.
- **Empty:** a pick through a source server that lists nothing shows no radios, and keeps its search field.
- **Indeterminate:** there's no tri-state. An epic's checkbox picks the epic, not "all of its items".

## Keyboard and ARIA

- Native controls, so Space checks a checkbox, and the arrow keys move between radios with the same `name` and pick as they go. Tab reaches the checked radio of a group, or the first when none is.
- Every pick checkbox needs `aria-label="Pick {title}"`: the row's title is in another cell, not its label. The epic's says the epic's title; its `title` tooltip says "Pick {KEY} itself, not its items".
- A radio list is a `<fieldset>` with a `<legend>`, so a screen reader says the setting's name on entering it. The about line isn't tied to the group with `aria-describedby`.
- A pick checkbox stays in the tab order while invisible. Tabbing into a row's checkbox shows it.

## Content

- Option labels are sentence case and say what the person gets, not the setting's internal value: "Stay on this thread", "Go to the next thing that needs you".
- Show an example where the difference is a format: "Relative, such as 3 min ago".
- Mark the default where there is one, in brackets: "Graphite (the default)".
- A pick checkbox's label is "Pick" and the item's title, not its key.
- A picked option through a source server is written "{name} ({value})": "Synthetic (SYN)".

## Where the app uses it

- `.pick`: `.pick`, `.pick input` and `.item:hover .pick` in `window.css`. A row's is drawn by `Item` in `packages/web/src/window-page.tsx`, and the epic's `.anchor-pick` by `Cluster` in `packages/web/src/window-page.tsx`; its CSS is `.anchor-pick` twice in `window.css`, the second for a narrow page. `.clusters[data-picking]`: `Body` in `packages/web/src/window-page.tsx`.
- `Choices` in `packages/web/src/settings-page.tsx`, the radio list, used for Times and After you approve (`General` in `packages/web/src/settings-page.tsx`), Theme and Text size (`Appearance` in `packages/web/src/settings-page.tsx`), Sending a question (`Asking` in `packages/web/src/settings-page.tsx`) and How often it syncs (`Options` in `packages/web/src/connections-page.tsx`). CSS `.choices`, `.choice` and `.choice input` in `window.css`.
- A pick through a source server: `PickOption` in `packages/web/src/connections-page.tsx`.

## Drift

Status **drifting**.

- The first run's `.cli-picked` is a third "picked" look, and not a control.
- No radio or checkbox has a disabled look of Oriel's own.

**Until a ChoiceList component lands, copy Choices** for a setting: `Choices` in `packages/web/src/settings-page.tsx` is exported, so import it. Its `about` explanation is optional; omit it when the label and options are enough. The [lab](/lab/checkbox-radio) has modern-CSS versions of both.
