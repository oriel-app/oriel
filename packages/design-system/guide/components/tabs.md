---
title: Tabs
status: drifting
group: Navigation
order: 30
classes: tabs, view-tabs, done-tabs
summary: A segmented row of a few words, one picked: Browse's Group by (buttons, aria-pressed), and the Overview/Browse and Done/Dropped tabs (links, aria-current).
---

# Tabs

## What it is

A short row of words where one is picked, drawn as a segmented control: faint words, and the picked one on a `--surface` fill with a 1px `--line` ring (`.tabs` in `window.css`). One class, `.tabs`, holds two different controls:

- **A segmented control** of buttons with `aria-pressed`, in a `role="group"`: Browse's **Group by** (Epic, Assignee, Stuck, Linked). Picking one regroups the page in place.
- **Tabs that are links**, with `aria-current="page"`, in a `<nav>`: the window's **Overview** and **Browse** (`.view-tabs`), and the Done page's **Done** and **Dropped** (`.done-tabs`). Each is its own URL.

Neither is an ARIA tab list. There's no `role="tablist"` in Oriel: every "tab" here either goes to a page or changes how one page is drawn, and both are said plainly.

## When to use it

- **Buttons with `aria-pressed`:** two to five ways to show the same page, where switching is cheap and doesn't change what's saved. Group by is the one: it changes the grouping, not the items.
- **Links with `aria-current`:** two or three sibling pages a person moves between often, shown at the top of each: Overview and Browse; Done and Dropped. Each has a URL, so Back and a new tab work.
- Put it at the top of what it switches, on the page's head line (`.window-head`, `.overview-top`).

## When not to

- Not for a setting that's saved. A setting picked from a few is a set of [radios](/components/checkbox-radio) (`Choices`), whose picked state is a value, not a view.
- Not for more than about five options, or long labels. Use a [select](/components/select).
- Not for a page's sections in a column. Settings lists its sections as sidebar-style `.nav-link`s (`SettingsPage` in `packages/web/src/settings-page.tsx`); see [Sidebar](/components/sidebar).
- Not to hide content that has no URL of its own behind a tab strip. Oriel's views are pages or groupings, not panes.
- Not as filters. Browse's filters are selects and a search (`.filters`), which combine; a tab picks one.

## Anatomy and variants

Each tab is padded `0.25rem var(--space-3)`, `--radius`, `--weight-medium`, `--text-faint`. The picked one is `--text` on `--surface`, with `box-shadow: 0 0 0 var(--border-thin) var(--line)`. The row is `inline-flex` with a `--space-1` gap. The rule styles the `button` and `a` children by element, not by a class of their own.

```html specimen id=browse-head title="Browse's head: the view tabs (links), then Group by (buttons)"
<div class="window-head">
  <nav class="tabs view-tabs" aria-label="Window">
    <a href="/">Overview</a>
    <a href="/browse?grouping=epic" aria-current="page">Browse</a>
  </nav>
  <div class="tabs" role="group" aria-label="Group by">
    <button type="button" aria-pressed="true">Epic</button>
    <button type="button" aria-pressed="false">Assignee</button>
    <button type="button" aria-pressed="false">Stuck</button>
    <button type="button" aria-pressed="false">Linked</button>
  </div>
</div>
```

```html specimen id=overview-top title="The overview's head: the same view tabs, beside its counts"
<div class="overview-top">
  <nav class="tabs view-tabs" aria-label="Window">
    <a href="/" aria-current="page">Overview</a>
    <a href="/browse?grouping=epic">Browse</a>
  </nav>
  <p class="overview-counts" data-section="strip">
    <span class="overview-since">Since you looked Mon 2 Nov:</span>
    <button type="button" class="overview-stat" aria-expanded="false">
      <strong>14</strong> items changed
    </button>
    <span class="overview-stat"><strong>3</strong> workstreams moved</span>
  </p>
</div>
```

```html specimen id=done-tabs title="Done or dropped, with a count in each tab"
<nav class="tabs done-tabs" aria-label="Done or dropped">
  <a href="/done" aria-current="page">Done <span class="nav-count">24</span></a>
  <a href="/done?tab=dropped">Dropped <span class="nav-count">3</span></a>
</nav>
```

### Beside the radios it resembles

Picking one of a few is drawn six ways in Oriel (cms:B1). The two closest to tabs:

```html specimen id=compare title="A saved setting is radios; a page's sections are nav links"
<div class="ws-stack">
  <fieldset class="settings-field">
    <legend class="settings-field-name">Times</legend>
    <span class="settings-field-about"
      >How Oriel writes when something happened, everywhere but a review link's page.</span
    >
    <div class="choices">
      <label class="choice"
        ><input type="radio" name="settings-times" value="relative" checked />Relative, such as 3
        min ago</label
      >
      <label class="choice"
        ><input type="radio" name="settings-times" value="absolute" />Date and time, such as Nov 3,
        09:41</label
      >
    </div>
  </fieldset>
  <nav class="settings-sections" aria-label="Settings">
    <a class="nav-link" href="/settings" aria-current="page">Providers</a>
    <a class="nav-link" href="/settings/connections">Connections</a>
    <a class="nav-link" href="/settings/general">General</a>
  </nav>
</div>
```

Tabs and radios both pick one of a few. The difference is what picking does: a tab shows something else now and saves nothing; a radio changes a value that's kept. Settings' section list is tabs in all but look: links with `aria-current`, drawn as the sidebar's nav links, with a shadow the `.tabs` don't have.

## States

```html specimen id=state-rest title="Rest and picked" state=rest
<div class="tabs" role="group" aria-label="Group by">
  <button type="button" aria-pressed="false">Epic</button>
  <button type="button" aria-pressed="true">Assignee</button>
  <button type="button" aria-pressed="false">Stuck</button>
</div>
```

```html specimen id=state-hover title="Hover: the words darken; no fill" state=hover
<div class="tabs" role="group" aria-label="Group by">
  <button type="button" aria-pressed="false" class="ws-hover">Epic</button>
  <button type="button" aria-pressed="true">Assignee</button>
  <button type="button" aria-pressed="false">Stuck</button>
</div>
```

```html specimen id=state-focus title="Focus visible: the global ring, on a tab and on the picked one" state=focus-visible
<div class="ws-row">
  <div class="tabs" role="group" aria-label="Group by">
    <button type="button" aria-pressed="false" class="ws-focus-visible">Epic</button>
    <button type="button" aria-pressed="true">Assignee</button>
  </div>
  <nav class="tabs view-tabs" aria-label="Window">
    <a href="/" aria-current="page" class="ws-focus-visible">Overview</a>
    <a href="/browse?grouping=epic">Browse</a>
  </nav>
</div>
```

- **Rest:** `--text-faint` words, no fill.
- **Hover:** `--text` (`.tabs button:hover` in `window.css`). The picked one doesn't change.
- **Focus visible:** the global ring, 2px out (`:focus-visible` in `window.css`). The tabs are close together, so a ring overlaps the next tab's padding but not its words.
- **Picked:** `[aria-pressed="true"]` on a button, `[aria-current="page"]` on a link. The look is the same.
- **Active:** not styled.
- **Disabled:** none is ever disabled, and there's no rule for it. A grouping with nothing in it still shows, and says so on the page.
- **Loading:** the page under the tabs is `aria-busy` while it loads (`main.window`), not the tabs.
- **Error, empty:** don't apply to the tabs.

## Keyboard and ARIA

- **Group by:** `<div class="tabs" role="group" aria-label="Group by">` of `<button type="button" aria-pressed>`. Each is a tab stop; Enter or Space picks it. The arrow keys don't move between them; it isn't a radio group or a tab list.
- **Page tabs:** `<nav class="tabs …" aria-label="Window">` of `<a href aria-current="page">`. Each is a link, a tab stop, and Enter follows it. The `nav`'s label names the set: "Window", "Done or dropped".
- Don't add `role="tablist"`, `role="tab"` or `aria-selected` to either: there are no tab panels, and a screen reader would announce keys that don't work.
- A count inside a tab (`.nav-count`) is read as part of its name: "Done 24". Give it words around it if the number isn't obvious.

## Content

- One or two words each, in sentence case, nouns: **Overview**, **Browse**; **Epic**, **Assignee**, **Stuck**, **Linked**; **Done**, **Dropped**.
- The group's name says what the tabs choose: "Group by", "Window", "Done or dropped".
- A count follows the word, quiet: "Dropped 3".

## Where the app uses it

- CSS: `.tabs`, `.tabs button`, `.tabs button:hover` and `.tabs button[aria-pressed="true"]` in `window.css`; `.tabs a { text-decoration: none }` again further down; `.done-tabs` and `.view-tabs` in `window.css`.
- Group by: `Tabs` in `packages/web/src/window-page.tsx`, which `WindowPage` puts in Browse's head.
- Overview and Browse: `ViewTabs` in `packages/web/src/overview-page.tsx`, used by `OverviewPage` there and by `WindowPage` in `packages/web/src/window-page.tsx`.
- Done and Dropped: `DonePage` in `packages/web/src/other-pages.tsx`.
- The radios and section list it resembles: `Choices` in `packages/web/src/settings-page.tsx`, and `SettingsPage`'s sections.

## Drift

Status **drifting**, as part of "pick one of a few" (cms:B1 in [the drift report](/drift)):

- One `.tabs` rule styles two controls, buttons and links, by element (`.tabs button`, `.tabs a`), with no class of their own.
- `text-decoration: none` is set on `.tabs a` twice in `window.css`: beside `.tabs button`, and again on its own.
- The padding is a raw `0.25rem` (`.tabs button` in `window.css`), like `.button`'s.
- Settings' section list is the same idea with the sidebar's look, shadow included, and turns from a column into a wrapped row at 760px.
- Radios are drawn two more ways (`.choices` and `.choice-rows`), and the first run fakes a third picked look (`.cli-picked`).

**Until it's consolidated:** for a view of the same page, copy `Tabs` (buttons with `aria-pressed` in a labelled `role="group"`). For sibling pages, copy `ViewTabs` (links with `aria-current` in a labelled `nav`). For a saved setting, copy `Choices`. The proposal splits `.tabs` into a `Segmented` control and a `TabNav`, and folds the radio lists into one `RadioList`.
