---
title: List rows
status: drifting
group: Rows
order: 50
classes: overview-rows, overview-row, overview-title, overview-sub, overview-workstream, overview-workstream-name, overview-spark, overview-moved, overview-quiet, overview-last, overview-workstream-detail, overview-moved-items, overview-signal, overview-candidates, overview-group, overview-rule, derived-tag, derived-note, overview-candidate, overview-make, overview-person, overview-more, status-bar, segment, done, in-progress, todo, empty, clusters, stale, cluster, cluster-head, picked, pick, anchor-pick, cluster-toggle, chevron, cluster-name, cluster-label, cluster-details, origin, derived, cluster-meta, count, points-sum, unestimated, make-workstream, items, item, title, points, idle, assignee, none, avatar, replies, more-items, more-count, no-items, items-loading, members, member, member-title, gone, remove-member, type, key, source-link, status, state-chip, thread-list, thread-link, thread-link-title, thread-link-workstream, thread-link-at, pager, pager-where, history, changes, quiet-action, tooltip
summary: One line per thing in a list: a workstream on the overview, a candidate under its rule, a person, a Browse cluster and its items, a workstream's items, and threads. Several shapes, each for one kind of list.
---

# List rows

## What it is

A list row is one thing, on one line (sometimes with a second line of detail under it), in a list of things of its kind. Oriel has no single row component. It has a row shape per list, each tuned for what that list is for:

- **Workstream row** (`li.overview-row.overview-workstream`): the overview's line for each open workstream. Its name, a 14-day spark, a status bar, what moved, and how long ago; then a detail line with its sources, its threads, the items that moved and any derived signal. Decision 0027 calls it "a card for each workstream", but the code draws a row: "A workstream, a line each, and its detail under it." (`.overview-workstream` in `window.css`).
- **Candidate row** (`li.overview-candidate`): "Not in a workstream yet". An item or a cluster, grouped under the Oriel rule that found it, with its source; a cluster's row offers **Make a workstream**.
- **Person row** (`li.overview-row.overview-person`): "In progress, by person". A name, and a count with the workstream holding most of it.
- **Cluster row** (`section.cluster > h2.cluster-head`): Browse's heading for a cluster: a disclosure button with its name, key, origin, item count, points and status bar, and **Make workstream** on hover. "A cluster closed is its header row; opened, its items follow." (`.cluster + .cluster` in `window.css`).
- **Item row**, two of them: Browse's `li.item` ("A cluster's items: one row per item, each one pickable.", `.items` in `window.css`) and the workstream page's `li.member` ("An item as Browse lists it: its type, key, title, and its status or replies; or a line saying the index no longer has it.", `Member` in `packages/web/src/parts.tsx`).
- **Thread row** (`a.thread-link` in `ul.thread-list`): a thread on a workstream page or the Done page: title, maybe its workstream, its state chip, when.

The sidebar's rows are on [Sidebar](/components/sidebar); the rail's compact item rows on [Right rail](/components/right-rail); Settings' rows on [Connection and provider rows](/components/connection-row). The list frames, section heads and "N more" around these rows are on [Overview sections](/components/overview-section).

## When to use it

- Use the row shape of the list you're adding to. A new kind of row in an existing list copies its siblings exactly.
- **A list of items** anywhere but Browse: copy `.member`. It's the one component, `Member` in `packages/web/src/parts.tsx`, used by the workstream page and the right rail.
- **A workstream at a glance** on the overview: `.overview-workstream`. Its numbers are computed by the server, never generated, and each derived line shows its rule.
- **Something a rule found**: `.overview-candidate` under an `.overview-rule` line that says the rule, with the `.derived-tag` "Oriel rule".
- **A list of threads**: `.thread-link` rows in a `ul.thread-list`.
- **A cluster that opens in place**: only in Browse, as `.cluster`.

## When not to

- Not a card. If a thing needs a box of its own (a change set, a connect step, a failure with its help), it isn't a row; see [Change set](/components/change-set) and [Empty, loading and error](/components/states).
- Not `.item` outside Browse. Its seven columns (pick, key, title, status, assignee, points, idle) and its checkbox only make sense where items are picked into a workstream.
- Not `.thread-link` for something that isn't a thread. The Done page puts done workstreams in it, with "4 threads" in the workstream column; that's drift, not a pattern (see Drift).
- Not a table. Oriel has no data grid; a block's table is read-only and is on [Block](/components/block).
- Don't hide the row's only action behind hover without a keyboard path: every hover-revealed action here is still a tab stop, and shows when focused.

## Anatomy and variants

### Workstream rows, on the overview

A grid of five columns, `minmax(0,1fr) 3.5rem 5rem 7.5rem 4rem` (`.overview-workstream` in `window.css`): name, spark, status bar, moved, last. The detail line spans the row in `--text-xs`. The row's padding is `--row-pad` (0.375rem; 0.5rem in Broadsheet), and rows are split by a `--line` hairline.

```html specimen id=workstream-rows title="Workstream rows: moved, quiet, and with no items"
<ul class="overview-rows">
  <li class="overview-row overview-workstream" data-workstream="ws-checkout">
    <a class="overview-title overview-workstream-name" href="/workstreams/ws-checkout"
      >Checkout v2: phone wallets and saved cards</a
    >
    <svg
      class="overview-spark"
      viewBox="0 0 56 17"
      role="img"
      aria-label="23 changes in the last 14 days"
    >
      <title>23 changes in the last 14 days</title>
      <polyline
        points="0,16 4.3,13.2 8.6,16 12.9,10.4 17.2,7.6 21.5,13.2 25.8,16 30.2,16 34.5,4.8 38.8,10.4 43.1,13.2 47.4,7.6 51.7,2 56,13.2"
      />
    </svg>
    <span
      class="status-bar"
      role="img"
      aria-label="5 done, 4 in progress, 5 to do"
      title="5 done, 4 in progress, 5 to do"
    >
      <span class="segment done" style="flex-grow: 5"></span>
      <span class="segment in-progress" style="flex-grow: 4"></span>
      <span class="segment todo" style="flex-grow: 5"></span>
    </span>
    <span class="overview-moved"><strong>4</strong> moved, 1 done</span>
    <span class="overview-last" title="Latest member update or thread activity">today</span>
    <span class="overview-workstream-detail">
      <span>15 Jira</span>
      <span>2 waiting on you · 1 working · 3 done</span>
      <span class="overview-moved-items">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-23"
          ><span class="key">SYN-23</span> Pay with a phone wallet on the website</a
        >
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-99"
          ><span class="key">SYN-99</span> Save a card for next time</a
        >
      </span>
      <span
        class="overview-signal"
        title="Oriel rule: A member in progress with no update in 14 days"
        >3 in progress, no update in 14 days</span
      >
    </span>
  </li>
  <li class="overview-row overview-workstream" data-workstream="ws-weather">
    <a class="overview-title overview-workstream-name" href="/workstreams/ws-weather"
      >Weather disruptions and rebooking</a
    >
    <svg
      class="overview-spark"
      data-quiet
      viewBox="0 0 56 17"
      role="img"
      aria-label="0 changes in the last 14 days"
    >
      <title>0 changes in the last 14 days</title>
      <polyline
        points="0,16 4.3,16 8.6,16 12.9,16 17.2,16 21.5,16 25.8,16 30.2,16 34.5,16 38.8,16 43.1,16 47.4,16 51.7,16 56,16"
      />
    </svg>
    <span
      class="status-bar"
      role="img"
      aria-label="4 done, 1 in progress, 7 to do"
      title="4 done, 1 in progress, 7 to do"
    >
      <span class="segment done" style="flex-grow: 4"></span>
      <span class="segment in-progress" style="flex-grow: 1"></span>
      <span class="segment todo" style="flex-grow: 7"></span>
    </span>
    <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
    <span class="overview-last" title="Latest member update or thread activity">16d ago</span>
    <span class="overview-workstream-detail">
      <span>12 Jira</span>
      <span
        class="overview-signal"
        title="Oriel rule: No member update and no thread activity in 14 days"
        >Nothing moved in 16 days</span
      >
    </span>
  </li>
  <li class="overview-row overview-workstream" data-workstream="ws-gift">
    <a class="overview-title overview-workstream-name" href="/workstreams/ws-gift">Gift cards</a>
    <svg
      class="overview-spark"
      data-quiet
      viewBox="0 0 56 17"
      role="img"
      aria-label="0 changes in the last 14 days"
    >
      <title>0 changes in the last 14 days</title>
      <polyline
        points="0,16 4.3,16 8.6,16 12.9,16 17.2,16 21.5,16 25.8,16 30.2,16 34.5,16 38.8,16 43.1,16 47.4,16 51.7,16 56,16"
      />
    </svg>
    <span class="status-bar empty"></span>
    <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
    <span class="overview-last" title="Latest member update or thread activity">today</span>
    <span class="overview-workstream-detail"><span>No items</span></span>
  </li>
</ul>
```

- **Name**: a link to the workstream, ellipsised on one line (wrapping under 760px).
- **Spark** (`svg.overview-spark`, 56×17): "Changes logged on each of the last 14 days, as a line." (`Spark` in `packages/web/src/overview-page.tsx`). It's `role="img"` with the total as its name. With no changes it's `data-quiet` and draws in `--line-strong`; otherwise `--in-progress`.
- **Status bar** (`.status-bar`): "Items by status category, as one bar. Its parts are counts, not estimates." (`StatusBar` in `packages/web/src/window-page.tsx`). Segments are always done, in progress, to do, and its name says the counts: "5 done, 4 in progress, 5 to do". With nothing to count it's `.status-bar.empty`, which keeps its space hidden.
- **Moved**: "**4** moved, 1 done", or `none moved` in `.overview-quiet`.
- **Last**: "today" or "16d ago", with the title "Latest member update or thread activity".
- **Detail**: sources ("15 Jira", "3 Folder · 3 Jira", or "No items"), threads ("2 waiting on you · 1 working · 3 done", and "N dropped"), the items that moved (each opens in the [item panel](/components/item-panel)), and each derived signal in `--derived`, with "Oriel rule: …" in its title.

### Candidate rows: "Not in a workstream yet"

Grouped under the rule that found them. The list is a `div.overview-rows.overview-candidates` holding one `.overview-group` per rule, each an `.overview-rule` line and a `ul`. Candidate rows are tighter than other overview rows (`0.1875rem` padding) and have no hairline between them.

```html specimen id=candidate-rows title="Candidate rows, under their rules"
<div class="overview-rows overview-candidates">
  <div class="overview-group">
    <p class="overview-rule">
      <span class="derived-tag">Oriel rule</span> An epic no workstream holds
    </p>
    <ul>
      <li class="overview-candidate" data-rule="An epic no workstream holds">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-4"
          >Vehicle and freight reservations</a
        >
        <span class="overview-sub">11 items · Jira · 2 changed this week</span>
        <button
          type="button"
          class="quiet-action overview-make"
          aria-label="Make a workstream of Vehicle and freight reservations"
        >
          Make a workstream
        </button>
      </li>
      <li class="overview-candidate" data-rule="An epic no workstream holds">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-5"
          >Accessibility audit remediation (WCAG 2.2 AA)</a
        >
        <span class="overview-sub">41 items · Jira</span>
        <button
          type="button"
          class="quiet-action overview-make"
          aria-label="Make a workstream of Accessibility audit remediation (WCAG 2.2 AA)"
        >
          Make a workstream
        </button>
      </li>
    </ul>
  </div>
  <div class="overview-group">
    <p class="overview-rule">
      <span class="derived-tag">Oriel rule</span> In progress, no update in 14 days
    </p>
    <ul>
      <li class="overview-candidate" data-rule="In progress, no update in 14 days">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-20"
          ><span class="key">SYN-20</span> Announce form errors on the vehicle step</a
        >
        <span class="overview-sub">Jira · 19 days idle</span>
      </li>
      <li class="overview-candidate" data-rule="In progress, no update in 14 days">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-46"
          ><span class="key">SYN-46</span> Move the staging database to the new region</a
        >
        <span class="overview-sub">Jira · 23 days idle</span>
      </li>
    </ul>
  </div>
</div>
```

- A **cluster** row: its title links to its lead item (or is a plain `span.overview-title` with none), then "{N} items · {source} · {detail}", then **Make a workstream**.
- An **item** row: its key and title as one link, then "{source} · {detail}".
- **Make a workstream** "shows on the row the pointer or focus is on, and always where nothing hovers. It keeps its place while hidden, and no padding above or below, so showing it never moves the rows." (`.overview-make` in `window.css`). It's `opacity: 0` until `.overview-candidate:hover` or `:focus-within`. Because it keeps its place, it takes width from the row even when hidden: in the overview's side column the sub line of a cluster row is often squeezed to nothing.

```html specimen id=candidate-hover title="Pointed at: Make a workstream shows" state=hover
<div class="overview-rows overview-candidates">
  <div class="overview-group">
    <p class="overview-rule">
      <span class="derived-tag">Oriel rule</span> An epic no workstream holds
    </p>
    <ul>
      <li class="overview-candidate ws-hover" data-rule="An epic no workstream holds">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-4"
          >Vehicle and freight reservations</a
        >
        <span class="overview-sub">11 items · Jira · 2 changed this week</span>
        <button
          type="button"
          class="quiet-action overview-make"
          aria-label="Make a workstream of Vehicle and freight reservations"
        >
          Make a workstream
        </button>
      </li>
      <li class="overview-candidate" data-rule="An epic no workstream holds">
        <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-6"
          >Localisation for summer visitors</a
        >
        <span class="overview-sub">10 items · Jira</span>
        <button
          type="button"
          class="quiet-action overview-make"
          disabled
          aria-label="Make a workstream of Localisation for summer visitors"
        >
          Making…
        </button>
      </li>
    </ul>
  </div>
</div>
```

The second row is **making** ("Making…", disabled). While one is making, every other row's button is disabled too, and a made row's stays disabled; disabled shows at 0.5 even without hover (`.overview-candidate .overview-make:disabled` in `window.css`). The made workstream's Undo is a note in the [bead](/components/bead): "Made the workstream {name}, of {N} items." (see [Undo](/components/undo)).

### Person rows: "In progress, by person"

```html specimen id=person-rows title="Person rows"
<ul class="overview-rows">
  <li class="overview-row overview-person">
    <a
      class="overview-title"
      href="/browse?grouping=assignee&amp;assignee=amara&amp;status=in-progress"
      >Amara Okafor</a
    >
    <span class="overview-sub">7 · Boarding passes and gate scanning (1)</span>
  </li>
  <li class="overview-row overview-person">
    <a
      class="overview-title"
      href="/browse?grouping=assignee&amp;assignee=farid&amp;status=in-progress"
      >Farid Haddad</a
    >
    <span class="overview-sub">4</span>
  </li>
  <li class="overview-row overview-person">
    <a
      class="overview-title"
      href="/browse?grouping=assignee&amp;assignee=dara&amp;status=in-progress"
      >Dara Nikolaidis</a
    >
    <span class="overview-sub">3 · Checkout v2: phone wallets and saved cards (2)</span>
  </li>
</ul>
```

The name opens Browse by assignee, filtered to in progress. The sub is right-aligned and ellipsised. The app also puts `overview-people` on the list; it has no CSS, so it's left out here.

### Cluster rows, in Browse

```html specimen id=clusters title="Browse: one cluster open, its items, and closed clusters"
<div class="clusters" data-grouping="epic" data-anchored>
  <section class="cluster" data-open>
    <h2 class="cluster-head">
      <label class="pick anchor-pick" title="Pick SYN-1 itself, not its items">
        <input type="checkbox" aria-label="Pick Checkout v2: phone wallets and saved cards" />
      </label>
      <button
        type="button"
        class="cluster-toggle"
        aria-expanded="true"
        aria-controls="items-epic-SYN-1"
      >
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name">
          <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
          <span class="key">SYN-1</span>
        </span>
        <span class="cluster-details">
          <span class="origin" title="This cluster is in Jira">Jira</span>
          <span class="cluster-meta">
            <span class="count">14 items</span>
            <span class="points-sum">29 pts · <span class="unestimated">3 unestimated</span></span>
            <span
              class="status-bar"
              role="img"
              aria-label="6 done, 4 in progress, 4 to do"
              title="6 done, 4 in progress, 4 to do"
            >
              <span class="segment done" style="flex-grow: 6"></span>
              <span class="segment in-progress" style="flex-grow: 4"></span>
              <span class="segment todo" style="flex-grow: 4"></span>
            </span>
          </span>
        </span>
      </button>
      <button type="button" class="quiet-action make-workstream">Make workstream</button>
      <span role="tooltip" popover="manual" class="tooltip"
        >Make a workstream of all 14 items in Checkout v2: phone wallets and saved cards as they are
        now</span
      >
    </h2>
    <ul class="items" id="items-epic-SYN-1">
      <li class="item">
        <label class="pick"
          ><input type="checkbox" aria-label="Pick Remove the legacy web-view checkout"
        /></label>
        <a
          class="key source-link"
          href="https://ferrowick.atlassian.net/browse/SYN-10"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="task" title="Task"></span>SYN-10</a
        >
        <span class="title" title="Remove the legacy web-view checkout"
          >Remove the legacy web-view checkout</span
        >
        <span class="status" data-category="todo">To Do</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">CY</span>Chen Yuting</span>
        <span class="points" title="2 points">2</span>
        <span class="idle" title="Updated 26 days ago">26d</span>
      </li>
      <li class="item">
        <label class="pick"
          ><input type="checkbox" aria-label="Pick Pay with a phone wallet on the website"
        /></label>
        <a
          class="key source-link"
          href="https://ferrowick.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="story" title="Story"></span>SYN-23</a
        >
        <span class="title" title="Pay with a phone wallet on the website"
          >Pay with a phone wallet on the website</span
        >
        <span class="status" data-category="in-progress">In Progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points" title="Unestimated">–</span>
        <span class="idle" title="Updated 8 days ago">8d</span>
      </li>
      <li class="item">
        <label class="pick"
          ><input type="checkbox" aria-label="Pick Card form loses focus after autofill"
        /></label>
        <a
          class="key source-link"
          href="https://ferrowick.atlassian.net/browse/SYN-74"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="bug" title="Bug"></span>SYN-74</a
        >
        <span class="title" title="Card form loses focus after autofill"
          >Card form loses focus after autofill</span
        >
        <span class="status" data-category="done">Done</span>
        <span class="assignee none"><span class="avatar" aria-hidden="true"></span>Unassigned</span>
        <span class="points" title="3 points">3</span>
        <span class="idle" title="Updated today">today</span>
      </li>
    </ul>
    <p class="more-items">
      <button
        type="button"
        class="button"
        aria-label="Show 11 more of Checkout v2: phone wallets and saved cards's items"
      >
        Show 11 more
      </button>
      <span class="more-count">3 of 14 shown</span>
    </p>
  </section>
  <section class="cluster">
    <h2 class="cluster-head">
      <label class="pick anchor-pick" title="Pick SYN-3 itself, not its items">
        <input type="checkbox" aria-label="Pick Weather disruptions and rebooking" />
      </label>
      <button
        type="button"
        class="cluster-toggle"
        aria-expanded="false"
        aria-controls="items-epic-SYN-3"
      >
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name">
          <span class="cluster-label">Weather disruptions and rebooking</span>
          <span class="key">SYN-3</span>
        </span>
        <span class="cluster-details">
          <span class="origin" title="This cluster is in Jira">Jira</span>
          <span class="cluster-meta">
            <span class="count">12 items</span>
            <span class="points-sum">29 pts · <span class="unestimated">5 unestimated</span></span>
            <span
              class="status-bar"
              role="img"
              aria-label="4 done, 1 in progress, 7 to do"
              title="4 done, 1 in progress, 7 to do"
            >
              <span class="segment done" style="flex-grow: 4"></span>
              <span class="segment in-progress" style="flex-grow: 1"></span>
              <span class="segment todo" style="flex-grow: 7"></span>
            </span>
          </span>
        </span>
      </button>
      <button type="button" class="quiet-action make-workstream">Make workstream</button>
      <span role="tooltip" popover="manual" class="tooltip"
        >Make a workstream of all 12 items in Weather disruptions and rebooking as they are
        now</span
      >
    </h2>
  </section>
  <section class="cluster">
    <h2 class="cluster-head">
      <button
        type="button"
        class="cluster-toggle"
        aria-expanded="false"
        aria-controls="items-epic-none"
      >
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name"><span class="cluster-label">No epics in this source</span></span>
        <span class="cluster-details">
          <span class="origin derived" title="Oriel made this cluster; the source doesn't have it"
            ><span class="derived-tag">Oriel rule</span>Items from sources that have no epics</span
          >
          <span class="cluster-meta">
            <span class="count">3 items</span>
            <span class="points-sum"></span>
            <span class="status-bar empty"></span>
          </span>
        </span>
      </button>
      <button type="button" class="quiet-action make-workstream">Make workstream</button>
      <span role="tooltip" popover="manual" class="tooltip"
        >Make a workstream of all 3 items in No epics in this source as they are now</span
      >
    </h2>
  </section>
</div>
```

- `.clusters` is the frame: a `--line` border on `--surface`, in every theme (see Drift). `data-anchored` makes every heading leave room for the anchor's checkbox, so chevrons line up.
- The **toggle** is one button: chevron, name and key, then `.cluster-details` (`display: contents`) with the origin pill and `.cluster-meta`, whose count sits over the status bar in the items' status column and whose points sit over their assignee column (`.cluster-meta` in `window.css`).
- **Origin**: `.origin` names the source; `.origin.derived` is a dashed pill with the rule, for a cluster "Oriel made; the source doesn't have it".
- When any cluster is Oriel's, one line under the clusters says what the tag means, so a grouping with Oriel's clusters starts its list where every other grouping does (`.derived-note`): "**Oriel rule** marks a cluster Oriel made, which the source doesn't have. Each one shows its rule." (`Body` in `packages/web/src/window-page.tsx`).
- **Points**: "29 pts · 3 unestimated". A cluster of files shows none, "which isn't zero" (`ClusterPoints` in `packages/web/src/window-page.tsx`).
- **Make workstream** "waits on the row's right until the row is pointed at" (`.make-workstream` in `window.css`), absolutely placed in the 7rem the toggle reserves. Its tooltip says exactly what it copies.
- The anchor checkbox (`label.pick.anchor-pick`) picks the epic itself, "not its items". It shows on the heading's hover.

### Item rows, in Browse

Shown open above. A grid of `1.25rem 5.75rem minmax(0,1fr) 6.5rem 9rem 2rem 2.5rem` (`.item` in `window.css`): pick, key (with its type mark inside the link), title, status, assignee, points, idle. Row height is `--row`. The rows sit on `--surface-sunk`, split by a 60% `--line` hairline. Columns come from the connector: without an assignee, a message's replies (`a.replies`, "3 replies", a link to the message drawn by `Replies` in `packages/web/src/parts.tsx`) take that cell; without an estimate, the points cell is empty. Points read "–" with the title "Unestimated".

```html specimen id=item-picked title="Picking: the checkboxes show once anything is picked" state=picked
<div class="clusters" data-picking>
  <ul class="items" id="items-epic-SYN-2">
    <li class="item picked">
      <label class="pick"
        ><input type="checkbox" checked aria-label="Pick Scan boarding passes on the crew handset"
      /></label>
      <a
        class="key source-link"
        href="https://ferrowick.atlassian.net/browse/SYN-19"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="type" data-type="story" title="Story"></span>SYN-19</a
      >
      <span class="title" title="Scan boarding passes on the crew handset"
        >Scan boarding passes on the crew handset</span
      >
      <span class="status" data-category="in-progress">In Progress</span>
      <span class="assignee"><span class="avatar" aria-hidden="true">BH</span>Bastian Holm</span>
      <span class="points" title="5 points">5</span>
      <span class="idle" title="Updated 3 days ago">3d</span>
    </li>
    <li class="item">
      <label class="pick"
        ><input type="checkbox" aria-label="Pick Scanner can't read passes in direct sunlight"
      /></label>
      <a
        class="key source-link"
        href="https://ferrowick.atlassian.net/browse/SYN-30"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="type" data-type="bug" title="Bug"></span>SYN-30</a
      >
      <span class="title" title="Scanner can't read passes in direct sunlight"
        >Scanner can't read passes in direct sunlight</span
      >
      <span class="status" data-category="in-progress">In Progress</span>
      <span class="assignee"><span class="avatar" aria-hidden="true">HT</span>Hiro Tanabe</span>
      <span class="points" title="3 points">3</span>
      <span class="idle" title="Updated 11 days ago">11d</span>
    </li>
  </ul>
</div>
```

`data-picking` on `.clusters` (anything picked, or adding to a workstream) keeps every checkbox showing; a picked row is `--accent-soft`. What can be done with picked items is the picked-items bar, which isn't a row.

### Item rows, on a workstream page (`.member`)

A grid of `0.5rem 4.5rem minmax(0,1fr) auto 1.5rem` (`.member` in `window.css`): type mark, key, title, status (or replies), and the remove ×. Row height `--row`, framed by `.members`.

```html specimen id=members title="A workstream's items, with an item the index no longer has"
<ul class="members">
  <li class="member" data-item="jira:SYN-23">
    <span class="type" data-type="story" title="Story"></span>
    <a
      class="key source-link"
      href="https://ferrowick.atlassian.net/browse/SYN-23"
      target="_blank"
      rel="noopener noreferrer"
      >SYN-23</a
    >
    <span class="member-title">Pay with a phone wallet on the website</span>
    <span class="status" data-category="in-progress">In Progress</span>
    <button type="button" class="remove-member" aria-label="Remove SYN-23">×</button>
    <span role="tooltip" popover="manual" class="tooltip">Remove SYN-23 from this workstream</span>
  </li>
  <li class="member" data-item="jira:SYN-74">
    <span class="type" data-type="bug" title="Bug"></span>
    <a
      class="key source-link"
      href="https://ferrowick.atlassian.net/browse/SYN-74"
      target="_blank"
      rel="noopener noreferrer"
      >SYN-74</a
    >
    <span class="member-title">Card form loses focus after autofill</span>
    <span class="status" data-category="done">Done</span>
    <button type="button" class="remove-member" aria-label="Remove SYN-74">×</button>
    <span role="tooltip" popover="manual" class="tooltip">Remove SYN-74 from this workstream</span>
  </li>
  <li class="member" data-item="slack:C04PAYMNTS-1730712120.000200">
    <span class="type" data-type="message" title="Message"></span>
    <a
      class="key source-link"
      href="https://ferrowick.slack.com/archives/C04PAYMNTS/p1730712120000200"
      target="_blank"
      rel="noopener noreferrer"
      >Message</a
    >
    <span class="member-title">Has anyone tried phone wallets on the kiosk?</span>
    <a
      class="replies source-link"
      href="https://ferrowick.slack.com/archives/C04PAYMNTS/p1730712120000200"
      target="_blank"
      rel="noopener noreferrer"
      >3 replies</a
    >
    <button type="button" class="remove-member" aria-label="Remove C04PAYMNTS-1730712120.000200">
      ×
    </button>
    <span role="tooltip" popover="manual" class="tooltip"
      >Remove C04PAYMNTS-1730712120.000200 from this workstream</span
    >
  </li>
  <li class="member gone" data-item="jira:SYN-900">
    <span class="type" data-type=""></span>
    <a
      class="key source-link"
      href="https://ferrowick.atlassian.net/browse/SYN-900"
      target="_blank"
      rel="noopener noreferrer"
      >SYN-900</a
    >
    <span class="member-title">Not in the index</span>
    <button type="button" class="remove-member" aria-label="Remove SYN-900">×</button>
    <span role="tooltip" popover="manual" class="tooltip">Remove SYN-900 from this workstream</span>
  </li>
</ul>
```

- **Gone** (`.member.gone`): the index no longer has it. Its title is the last one known, or "Not in the index", faint and italic; its type mark is the plain grey square.
- **Remove** (`.remove-member`): a text "×", hidden until the row is pointed at or the × itself has keyboard focus; danger on hover. Its tooltip says "Remove {key} from this workstream".
- The rail draws the same `Member` without the ×, as `.members.compact`; see [Right rail](/components/right-rail).

### Thread rows

```html specimen id=thread-rows title="A workstream's threads"
<ul class="thread-list">
  <li>
    <a class="thread-link" href="/threads/t-estimates">
      <span class="thread-link-title">Which stories here still need estimates?</span>
      <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
      <span class="thread-link-at"
        ><time datetime="2026-11-04T09:12:00Z" title="Wed, Nov 4, 09:12">3 min ago</time></span
      >
    </a>
  </li>
  <li>
    <a class="thread-link" href="/threads/t-left">
      <span class="thread-link-title">What's left before checkout ships?</span>
      <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
      <span class="thread-link-at"
        ><time datetime="2026-11-04T08:40:00Z" title="Wed, Nov 4, 08:40">35 min ago</time></span
      >
    </a>
  </li>
  <li>
    <a class="thread-link" href="/threads/t-rollout">
      <span class="thread-link-title">Draft the saved cards rollout note</span>
      <span class="state-chip" data-state="working" data-waiting="agent">Agent working</span>
      <span class="thread-link-at"
        ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14">just now</time></span
      >
    </a>
  </li>
  <li>
    <a class="thread-link" href="/threads/t-whats-in">
      <span class="thread-link-title">What's in here?</span>
      <span class="state-chip" data-state="done">Done</span>
      <span class="thread-link-at"
        ><time datetime="2026-11-02T16:05:00Z" title="Mon, Nov 2, 16:05">2 days ago</time></span
      >
    </a>
  </li>
</ul>
```

A grid of `minmax(0,1fr) auto auto`, pulled out by `--space-3` either side so its hover fills the gutter. The [state chip](/components/badge) shows only when the thread waits on something, or its state differs from what the list says (a Done tab doesn't say "Done" on every row). An untitled thread reads "New thread". In the app each row is wrapped in its [context menu](/components/menu) (Mark done, Delete…).

```html specimen id=done-rows title="The Done page: workstreams, then threads with their workstream, then pages"
<div class="ws-stack">
  <ul class="thread-list">
    <li>
      <a class="thread-link" href="/workstreams/ws-declined">
        <span class="thread-link-title">Declined card retry</span>
        <span class="thread-link-workstream">4 threads</span>
        <span class="thread-link-at"
          ><time datetime="2026-11-02T10:00:00Z" title="Mon, Nov 2, 10:00">2 days ago</time></span
        >
      </a>
    </li>
  </ul>
  <ul class="thread-list">
    <li>
      <a class="thread-link" href="/threads/t-built">
        <span class="thread-link-title">Mark the built stories done</span>
        <span class="thread-link-workstream">Checkout v2: phone wallets and saved cards</span>
        <span class="thread-link-at"
          ><time datetime="2026-11-03T15:20:00Z" title="Tue, Nov 3, 15:20">yesterday</time></span
        >
      </a>
    </li>
    <li>
      <a class="thread-link" href="/threads/t-split">
        <span class="thread-link-title">Split the phone wallet story</span>
        <span class="thread-link-workstream">Checkout v2: phone wallets and saved cards</span>
        <span class="state-chip" data-state="handed-off">Handed off</span>
        <span class="thread-link-at"
          ><time datetime="2026-11-03T11:02:00Z" title="Tue, Nov 3, 11:02">yesterday</time></span
        >
      </a>
    </li>
  </ul>
  <nav class="pager" aria-label="Pages of done threads">
    <a class="quiet-action" href="/done?page=1">Previous</a>
    <span class="pager-where">Page 2 of 3 · 120 threads</span>
    <a class="quiet-action" href="/done?page=3">Next</a>
  </nav>
</div>
```

With `.thread-link-workstream` the grid becomes `minmax(0,1fr) minmax(0,12rem) auto`, and four columns when a chip shows too. The Done page shows 50 a page, with `.pager` under them ("Page 2 of 3 · 120 threads"); an end with no way on is an empty `<span>`.

### Versions, under a workstream's items

```html specimen id=history title="A workstream's versions, folded"
<details class="history" open>
  <summary>3 versions</summary>
  <ol class="changes">
    <li>
      <span>v3</span>
      <span
        >Added SYN-900, SYN-901 · by the agent in
        <a href="/threads/t-estimates">Which stories here still need estimates?</a></span
      >
      <span><time datetime="2026-11-04T09:10:00Z" title="Wed, Nov 4, 09:10">5 min ago</time></span>
    </li>
    <li>
      <span>v2</span>
      <span>Removed SYN-87 · by a sync</span>
      <span><time datetime="2026-11-03T12:00:00Z" title="Tue, Nov 3, 12:00">yesterday</time></span>
    </li>
    <li>
      <span>v1</span>
      <span>Made with 14 items</span>
      <span><time datetime="2026-11-01T09:00:00Z" title="Sun, Nov 1, 09:00">3 days ago</time></span>
    </li>
  </ol>
</details>
```

The app also sets `change-version` and `change-at` on the first and last cells; neither has CSS, so they're left out here.

### At 390

```html specimen id=narrow-workstream title="Workstream rows at 390: no spark, names wrap" width=390
<ul class="overview-rows">
  <li class="overview-row overview-workstream" data-workstream="ws-checkout">
    <a class="overview-title overview-workstream-name" href="/workstreams/ws-checkout"
      >Checkout v2: phone wallets and saved cards</a
    >
    <svg
      class="overview-spark"
      viewBox="0 0 56 17"
      role="img"
      aria-label="23 changes in the last 14 days"
    >
      <title>23 changes in the last 14 days</title>
      <polyline
        points="0,16 4.3,13.2 8.6,16 12.9,10.4 17.2,7.6 21.5,13.2 25.8,16 30.2,16 34.5,4.8 38.8,10.4 43.1,13.2 47.4,7.6 51.7,2 56,13.2"
      />
    </svg>
    <span
      class="status-bar"
      role="img"
      aria-label="5 done, 4 in progress, 5 to do"
      title="5 done, 4 in progress, 5 to do"
    >
      <span class="segment done" style="flex-grow: 5"></span>
      <span class="segment in-progress" style="flex-grow: 4"></span>
      <span class="segment todo" style="flex-grow: 5"></span>
    </span>
    <span class="overview-moved"><strong>4</strong> moved, 1 done</span>
    <span class="overview-last" title="Latest member update or thread activity">today</span>
    <span class="overview-workstream-detail">
      <span>15 Jira</span>
      <span>2 waiting on you · 1 working · 3 done</span>
    </span>
  </li>
</ul>
```

```html specimen id=narrow-items title="Browse items and a workstream's items at 390" width=390
<div class="ws-stack">
  <div class="clusters">
    <ul class="items" id="items-narrow">
      <li class="item">
        <label class="pick"
          ><input type="checkbox" aria-label="Pick Pay with a phone wallet on the website"
        /></label>
        <a
          class="key source-link"
          href="https://ferrowick.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="story" title="Story"></span>SYN-23</a
        >
        <span class="title" title="Pay with a phone wallet on the website"
          >Pay with a phone wallet on the website</span
        >
        <span class="status" data-category="in-progress">In Progress</span>
        <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
        <span class="points" title="Unestimated">–</span>
        <span class="idle" title="Updated 8 days ago">8d</span>
      </li>
    </ul>
  </div>
  <ul class="members">
    <li class="member" data-item="jira:SYN-23">
      <span class="type" data-type="story" title="Story"></span>
      <a
        class="key source-link"
        href="https://ferrowick.atlassian.net/browse/SYN-23"
        target="_blank"
        rel="noopener noreferrer"
        >SYN-23</a
      >
      <span class="member-title">Pay with a phone wallet on the website</span>
      <span class="status" data-category="in-progress">In Progress</span>
      <button type="button" class="remove-member" aria-label="Remove SYN-23">×</button>
    </li>
  </ul>
</div>
```

Under 760px: workstream rows drop the spark and wrap their names (`@media (max-width: 760px)` in `window.css`); Browse's item becomes two lines, title over key, status and assignee, with idle hidden; a member drops its status but keeps a message's replies ("A status gives way; a message's replies keep their place.", `.member` in `window.css`); thread rows drop the workstream and time columns. The last three are `@container page` rules, so they also apply beside the item panel on a wide screen.

## States

Hover and focus here are forced with the workshop's `ws-` classes, which copy window.css's own rules. Tab into any specimen to see the real thing.

```html specimen id=state-hover title="Hover" state=hover
<div class="ws-stack">
  <ul class="overview-rows">
    <li class="overview-row overview-person">
      <a class="overview-title ws-hover" href="/browse?grouping=assignee&amp;assignee=amara"
        >Amara Okafor</a
      >
      <span class="overview-sub">7 · Boarding passes and gate scanning (1)</span>
    </li>
  </ul>
  <ul class="members">
    <li class="member ws-hover" data-item="jira:SYN-99">
      <span class="type" data-type="story" title="Story"></span>
      <a
        class="key source-link"
        href="https://ferrowick.atlassian.net/browse/SYN-99"
        target="_blank"
        rel="noopener noreferrer"
        >SYN-99</a
      >
      <span class="member-title">Save a card for next time</span>
      <span class="status" data-category="todo">To Do</span>
      <button type="button" class="remove-member" aria-label="Remove SYN-99">×</button>
    </li>
  </ul>
  <div class="clusters">
    <ul class="items" id="items-hover">
      <li class="item ws-hover">
        <label class="pick"
          ><input type="checkbox" aria-label="Pick Save a card for next time"
        /></label>
        <a
          class="key source-link"
          href="https://ferrowick.atlassian.net/browse/SYN-99"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="type" data-type="story" title="Story"></span>SYN-99</a
        >
        <span class="title" title="Save a card for next time">Save a card for next time</span>
        <span class="status" data-category="todo">To Do</span>
        <span class="assignee"
          ><span class="avatar" aria-hidden="true">DN</span>Dara Nikolaidis</span
        >
        <span class="points" title="Unestimated">–</span>
        <span class="idle" title="Updated 75 days ago">75d</span>
      </li>
    </ul>
  </div>
  <ul class="thread-list">
    <li>
      <a class="thread-link ws-hover" href="/threads/t-estimates">
        <span class="thread-link-title">Which stories here still need estimates?</span>
        <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
        <span class="thread-link-at"
          ><time datetime="2026-11-04T09:12:00Z" title="Wed, Nov 4, 09:12">3 min ago</time></span
        >
      </a>
    </li>
  </ul>
</div>
```

```html specimen id=state-cluster-hover title="Hover on a cluster: the toggle tints, Make workstream and the anchor show" state=hover
<div class="clusters" data-anchored>
  <section class="cluster">
    <h2 class="cluster-head ws-hover">
      <label class="pick anchor-pick" title="Pick SYN-2 itself, not its items">
        <input type="checkbox" aria-label="Pick Boarding passes and gate scanning" />
      </label>
      <button
        type="button"
        class="cluster-toggle ws-hover"
        aria-expanded="false"
        aria-controls="items-epic-SYN-2"
      >
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name">
          <span class="cluster-label">Boarding passes and gate scanning</span>
          <span class="key">SYN-2</span>
        </span>
        <span class="cluster-details">
          <span class="origin" title="This cluster is in Jira">Jira</span>
          <span class="cluster-meta">
            <span class="count">12 items</span>
            <span class="points-sum">32 pts · <span class="unestimated">3 unestimated</span></span>
            <span
              class="status-bar"
              role="img"
              aria-label="3 done, 3 in progress, 6 to do"
              title="3 done, 3 in progress, 6 to do"
            >
              <span class="segment done" style="flex-grow: 3"></span>
              <span class="segment in-progress" style="flex-grow: 3"></span>
              <span class="segment todo" style="flex-grow: 6"></span>
            </span>
          </span>
        </span>
      </button>
      <button type="button" class="quiet-action make-workstream">Make workstream</button>
      <span role="tooltip" popover="manual" class="tooltip"
        >Make a workstream of all 12 items in Boarding passes and gate scanning as they are
        now</span
      >
    </h2>
  </section>
</div>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible
<div class="ws-stack">
  <ul class="overview-rows">
    <li class="overview-row overview-person">
      <a class="overview-title ws-focus-visible" href="/browse?grouping=assignee&amp;assignee=farid"
        >Farid Haddad</a
      >
      <span class="overview-sub">4</span>
    </li>
  </ul>
  <ul class="members">
    <li class="member" data-item="jira:SYN-41">
      <span class="type" data-type="story" title="Story"></span>
      <a
        class="key source-link"
        href="https://ferrowick.atlassian.net/browse/SYN-41"
        target="_blank"
        rel="noopener noreferrer"
        >SYN-41</a
      >
      <span class="member-title">Receipt email: include the vehicle registration</span>
      <span class="status" data-category="done">Done</span>
      <button type="button" class="remove-member ws-focus-visible" aria-label="Remove SYN-41">
        ×
      </button>
    </li>
  </ul>
  <div class="clusters">
    <section class="cluster">
      <h2 class="cluster-head">
        <button
          type="button"
          class="cluster-toggle ws-focus-visible"
          aria-expanded="false"
          aria-controls="items-epic-SYN-7"
        >
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span class="cluster-name"
            ><span class="cluster-label">Islander season passes</span
            ><span class="key">SYN-7</span></span
          >
          <span class="cluster-details">
            <span class="origin" title="This cluster is in Jira">Jira</span>
            <span class="cluster-meta">
              <span class="count">1 item</span>
              <span class="points-sum"></span>
              <span class="status-bar" role="img" aria-label="1 to do" title="1 to do"
                ><span class="segment todo" style="flex-grow: 1"></span
              ></span>
            </span>
          </span>
        </button>
        <button type="button" class="quiet-action make-workstream ws-focus-visible">
          Make workstream
        </button>
      </h2>
    </section>
  </div>
  <ul class="thread-list">
    <li>
      <a class="thread-link ws-focus-visible" href="/threads/t-left">
        <span class="thread-link-title">What's left before checkout ships?</span>
        <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
        <span class="thread-link-at"
          ><time datetime="2026-11-04T08:40:00Z" title="Wed, Nov 4, 08:40">35 min ago</time></span
        >
      </a>
    </li>
  </ul>
</div>
```

```html specimen id=state-busy title="Busy and failed: a stale grouping, and a page of items loading or failed" state=busy
<div class="ws-stack">
  <div class="clusters stale" inert>
    <section class="cluster">
      <h2 class="cluster-head">
        <button
          type="button"
          class="cluster-toggle"
          aria-expanded="false"
          aria-controls="items-assignee-amara"
        >
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span class="cluster-name"><span class="cluster-label">Amara Okafor</span></span>
          <span class="cluster-details">
            <span class="origin" title="This cluster is in Jira">Jira</span>
            <span class="cluster-meta"
              ><span class="count">9 items</span><span class="points-sum">24 pts</span
              ><span class="status-bar empty"></span
            ></span>
          </span>
        </button>
      </h2>
    </section>
  </div>
  <div class="clusters">
    <div class="items-loading" id="items-loading-demo">
      <p class="more-items" data-state="loading">Loading…</p>
    </div>
    <p class="more-items" data-state="failed" role="alert">
      <span>These items didn't load.</span>
      <button type="button" class="button">Try again</button>
    </p>
  </div>
</div>
```

```html specimen id=state-empty title="Empty" state=empty
<div class="ws-stack">
  <p class="overview-quiet">
    No workstreams yet. Make one from what isn't in a workstream yet, or from
    <a href="/browse">Browse</a>.
  </p>
  <p class="overview-quiet">Every item a rule finds is in a workstream.</p>
  <p class="overview-quiet">Nobody has work in progress.</p>
  <div class="clusters"><p class="no-items" id="items-empty">No items but SYN-7 itself.</p></div>
</div>
```

- **Rest, hover, focus-visible** are styled. Hover tints `.item`, `.thread-link` and `.cluster-toggle` with `--surface-hover`; overview titles turn `--accent`; `.member` has no hover of its own, only the × it reveals. An open cluster's toggle keeps the hover tint.
- **Focus** is the global ring on every link and button. `.cluster-toggle` draws it inset (`outline-offset: -2px`), so the frame's `overflow: clip` doesn't cut it.
- **Active** (pressed) isn't styled on any row.
- **Picked** (`.item.picked`, `.cluster-head.picked`): `--accent-soft`. **Gone** (`.member.gone`): faint italic title.
- **Disabled**: Make a workstream at 0.5 while another is making or once made; Make workstream while anything is pending. A row itself is never disabled.
- **Busy**: "Making…" on the candidate; Browse's whole list at 0.55 and `inert` while a new grouping or filter loads (`.clusters.stale`); "Loading…" in place of a page of items. `aria-busy` is on the page (`main.overview`, `main.window`), not on rows.
- **Error**: a page of items that didn't load says "These items didn't load." with Try again, as `role="alert"`. The overview's own failure is on [Empty, loading and error](/components/states).
- **Empty**: each list says why it's empty, in its own words (above), and the Done page: "No thread is done yet. One is once its change set is applied, or you mark it done." / "No thread is dropped. One is once a week goes by with nothing new in it." A workstream with no items: "No items. Add some from the window."

## Keyboard and ARIA

- Every list is a real `ul` (or `ol` for versions), one `li` per row. The candidates are the exception: a `div.overview-rows` of `.overview-group`s, each with its own `ul`.
- A row's tab stop is its link (the name, the title, the key) and then its own buttons. Nothing makes a whole `li` focusable.
- **Status bars and sparks** are `role="img"` with the counts as their name: "5 done, 4 in progress, 5 to do", "23 changes in the last 14 days". An empty bar has no role.
- **Cluster toggle**: a button with `aria-expanded` and `aria-controls` pointing at the items' list; the loading and empty paragraphs keep that id, so its target always exists. Enter or Space opens it.
- **Make a workstream** has the label "Make a workstream of {name}", since the visible words don't name the cluster. Browse's Make workstream relies on its tooltip for that (see Drift).
- **Pick** checkboxes are named "Pick {title}"; the anchor's title says "Pick SYN-1 itself, not its items".
- **Remove ×** is named "Remove {key}". When a row is removed with its × focused, focus moves to the next row's ×, else the previous one's, else Add from the window; after Undo, it returns to the restored row's × (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`). The window's Undo notes (`WindowUndos` in `packages/web/src/end-workstream.tsx`) come after the list in the page "so the keyboard reaches them from the last row".
- **Items open in the item panel** on a plain click (a modified click goes to the source); with the list as context, ↑ and ↓ step through it. See [Item panel](/components/item-panel).
- **Thread rows** carry a context menu: right-click, the Menu key or Shift+F10, with Mark done and Delete…. See [Menu](/components/menu).
- Rules and dates live in `title` attributes ("Oriel rule: …", "Latest member update or thread activity"), which a keyboard can't reach. Say anything that matters in the row's words.

## Content

- A workstream row's numbers are computed, never generated: "**4** moved, 1 done", "none moved", "today", "16d ago".
- The detail line joins its parts with " · ": "15 Jira", "2 waiting on you · 1 working · 3 done". Signals say what's wrong in plain words: "Nothing moved in 16 days", "3 in progress, no update in 14 days".
- A rule line starts with the tag **Oriel rule** and then the rule, sentence case: "An epic no workstream holds", "In progress, no update in 14 days".
- Candidate subs: "11 items · Jira · 2 changed this week", "Jira · 19 days idle". Person subs: "7 · Boarding passes and gate scanning (1)".
- Browse: "14 items" (filtered: "4 of 14 items"), "29 pts · 3 unestimated", "Show 11 more" with "3 of 14 shown", "Loading…", "These items didn't load.", and the empties "No items.", "None of its items match.", "No items but SYN-7 itself."
- The overview says **Make a workstream**; Browse says **Make workstream** (see Drift). Busy: **Making…**.
- An item the index lost: "Not in the index". An untitled thread: "New thread".
- Versions: "Made with 14 items", "Added SYN-900, SYN-901", "Removed SYN-87", then " · by the agent in {thread}", " · by an outside tool", " · from a review link", " · by an applied change set", " · by a sync".

## Where the app uses it

- Workstream rows: `WorkstreamRow` in `packages/web/src/overview-page.tsx`; the spark, `Spark` in `packages/web/src/overview-page.tsx`; the cap of 8 plus 4 quiet, `shown` in `packages/web/src/overview.ts`. CSS `.overview-workstream`, `.overview-workstream-name`, `.overview-moved`, `.overview-last`, `.overview-workstream-detail`, `.overview-moved-items`, `.overview-signal` and `.overview-spark` in `window.css`; the list frame and row, `.overview-rows` and `.overview-row` in `window.css`.
- Candidate rows, with Make a workstream: `Candidates` and `CandidateRow` in `packages/web/src/overview-page.tsx`. CSS `.overview-candidates`, `.overview-group ul`, `.overview-rule`, `.overview-candidate`, `.overview-make` and `.overview-candidate .overview-make:disabled` in `window.css`.
- Person rows: `PersonRow` in `packages/web/src/overview-page.tsx`; CSS `.overview-person` in `window.css`.
- The status bar: `StatusBar` in `packages/web/src/window-page.tsx`; CSS `.status-bar` in `window.css`.
- Clusters, with Make workstream: `Cluster` in `packages/web/src/window-page.tsx`; their container, `Body` in `packages/web/src/window-page.tsx`. CSS `.clusters`, `.cluster + .cluster`, `.cluster-head`, `.cluster-toggle`, `.make-workstream`, `.anchor-pick`, `.cluster-details`, `.chevron`, `.cluster-name`, `.cluster-label`, `.key`, `.source-link`, `.origin`, `.cluster-meta`, `.count` and `.unestimated` in `window.css`.
- Browse items and paging: `Item` and `More` in `packages/web/src/window-page.tsx`. CSS `.items`, `.no-items`, `.more-items`, `.more-count`, `.item`, `.pick`, `.type`, `.title`, `.status`, `.assignee`, `a.replies`, `.avatar`, `.points` and `.idle` in `window.css`.
- Members: `Member` in `packages/web/src/parts.tsx`, listed by `WorkstreamPage` in `packages/web/src/workstream-page.tsx`. CSS `.members`, `.member`, `.member-title` and `.remove-member` in `window.css`.
- Thread rows: `Threads` in `packages/web/src/workstream-page.tsx`; the Done page and its pager, `DonePage` in `packages/web/src/other-pages.tsx`. CSS `.thread-list`, `.thread-link`, `.thread-link-title`, `.thread-link-workstream` and `.pager` in `window.css`.
- Versions: `History` in `packages/web/src/workstream-page.tsx`; CSS `.history` in `window.css`.
- Narrow: `@media (max-width: 760px)` in `window.css` (overview, by viewport) and `@container page (max-width: 760px)` in `window.css` (Browse, members and thread rows, by the page's width).

## Drift

Status **drifting**. The row shapes are deliberately different, but the same jobs are done several ways. From the drift report ([rfc:R1, R3, R4, R5, R6](/drift)):

- **Framed lists ignore the theme (R1).** `.overview-rows` takes `--list-frame` and `--list-bg`, so Broadsheet draws it open on the page. `.clusters` and `.members` in `window.css` hard-code a `--line` border on `--surface`, so Browse and a workstream's items keep a white framed card in every theme. Row separators are written three ways at two strengths (`--line`, or 60% `--line`).
- **One item, three rows (R3).** Browse's `.item` and the workstream's `.member` draw the same thing (type, key, title, status) with different grids, padding (`--space-6` against `--space-3`) and markup (Browse puts the type mark inside the key's link and doesn't use `ItemKey`). The overview's candidate draws it a third way, and a block's rows a fourth. `Member` in `packages/web/src/parts.tsx` still takes an `inRegion` prop no caller passes.
- **Row heights off the tokens (R4).** Browse and member rows use `--row`; the person row overrides `--row-pad` with `0.25rem`, the candidate row uses `0.1875rem`, and the cluster head `2.75rem`, so Broadsheet's roomier rows don't reach them.
- **Five reveals (R5).** Make a workstream shows on the row's `:hover` or `:focus-within`, at full strength on touch. Browse's Make workstream shows on the row's hover or its own `:focus-visible`, with a fade; Browse's pick shows at 0.7 on touch; the member × at 0.6. A mouse click on Browse's Make workstream or the × focuses it without `:focus-visible`, so it hides again under the pointer that just clicked it.
- **Two "make" buttons.** "Make a workstream" (`.overview-make`) and "Make workstream" (`.make-workstream`) do the same thing with different words, show rules and naming: the overview's has an `aria-label` naming the cluster, Browse's only a tooltip.
- **Thread and workstream rows (R6).** The Done page puts done workstreams in `.thread-link`, with "4 threads" in `.thread-link-workstream` (`DonePage` in `packages/web/src/other-pages.tsx`). `.thread-link` has no row height token.
- **`.overview-quiet` twice.** It's the block empty line and the inline "none moved" inside `.overview-moved`, so "none moved" draws at `--text-md`, a step larger than "4 moved" beside it (`.overview-quiet` and `.overview-moved` in `window.css`).
- **The ×'s name uses the raw key.** The row shows `keyLabel` ("Message" for a chat message, "File" for a file), but the × is named `Remove ${ref.key}` (`Member` in `packages/web/src/parts.tsx`), so a message's × reads "Remove C04PAYMNTS-1730712120.000200" to a screen reader and in its tooltip. The specimen shows it as the app does.
- **Unstyled hooks.** The classes `overview-people`, `change-version` and `change-at`, and `data-state` on `.more-items`, carry no CSS.

Which to copy, until a `ListFrame` and an `ItemRow` settle it:

- **A list of items**: copy `.member` in `.members`, as the specimen above, with `TypeMark` and `ItemKey`. Don't copy Browse's `.item` outside Browse.
- **A row on the overview**: `li.overview-row` in `ul.overview-rows` (it follows the theme); add the shape class (`.overview-workstream`, `.overview-person`) only for those lists.
- **An action revealed on a row**: copy the candidate's rule (shown on the row's `:hover` and `:focus-within`, always on touch, keeping its place), and give it an `aria-label` that names the row's thing.
- **A list of threads**: `.thread-link`, for threads only. A list of workstreams outside the overview is a row of its own, not `.thread-link`.
- **"Make a workstream"** is the words to use; "Make workstream" is the outlier.
