---
title: State chip, status and counts
status: drifting
group: Display
order: 41
classes: state-chip, status, state-dot, nav-waiting-on, working-dot, type, assignee, avatar, bar-count, nav-count, overview-count, overview-stat, provider-badge
summary: The small marks that say where something stands or how many: a thread's state chip, an item's status, the sidebar's dots, kind marks, initials, counts and the Preview badge. One idea, five colour maps.
---

# State chip, status and counts

## What it is

The small marks beside a name that say where it stands, what kind it is, whose it is or how many there are. None of them is a control; each is a word, a dot or a number.

- **State chip** (`.state-chip`): a thread's state as a soft pill. A working thread reads as what it waits on: "a working thread reads as what it waits on, so one whose agent has finished doesn't look busy" (`waitingNames` in `packages/web/src/parts.tsx`).
- **Status** (`.status`): an item's status, in its source's own words ("In Progress"), coloured by its category.
- **State dot** (`.state-dot`) and **waiting word** (`.nav-waiting-on`): the same states as the state chip, in the sidebar, where there's no room for a pill. A **working dot** (`.working-dot`) says an agent is busy in a workstream.
- **Type mark** (`.type`): an item's kind, "told by its mark's shape: a square, but a bug's dot" (`.type` in `window.css`).
- **Assignee** (`.assignee` with `.avatar`): initials in a circle, and the name.
- **Counts**: the filled needs-you count (`.bar-count`), quiet counts after a label (`.nav-count`, `.overview-count`), and the overview's counts strip (`.overview-stat`).
- **Preview badge** (`.provider-badge`): an outlined pill on Codex's row in Settings (decision 0048).

It isn't a [chip](/components/chip). A chip is a thing an agent names in a sentence; a state chip is a pill for a thread's state. The words are close; the jobs aren't.

### The state-to-colour map

The accent means "your move" (decision 0034): "Needs you, a change set to review, Approve. There's no separate needs-you colour." In progress is under way, done has landed, and to do or over is grey. Today that map is written five times, once per mark:

| State                           | Words          | `.state-chip`      | `.state-dot`        | `.nav-waiting-on` | `.chip`            |
| ------------------------------- | -------------- | ------------------ | ------------------- | ----------------- | ------------------ |
| `working`, waiting on `agent`   | Agent working  | in progress        | in progress, pulses | in progress       | in progress        |
| `working`, waiting on `apply`   | Applying…      | in progress        | in progress, pulses | in progress       | in progress        |
| `working`, waiting on `review`  | Needs review   | **accent**         | **accent**          | **accent**        | accent (needs you) |
| `working`, waiting on `held`    | Message held   | **accent**         | **accent**          | **accent**        | accent (needs you) |
| `working`, waiting on `stalled` | Apply stalled  | **accent**         | **accent**          | **accent**        | accent (needs you) |
| `working`, waiting on `draft`   | Draft to apply | in progress        | in progress         | in progress       | accent (needs you) |
| `working`, waiting on `reply`   | Your turn      | in progress        | in progress         | in progress       | accent (needs you) |
| `done`                          | Done           | done               | done                | –                 | done               |
| `handed-off`                    | Handed off     | handed off         | handed off          | –                 | handed off         |
| `dropped`                       | Dropped        | **grey (no rule)** | hollow ring         | –                 | hollow dot         |

An item's status has three categories: `todo` grey, `in-progress` and `done`, the same in `.status` and in a chip. Draft to apply and Your turn wait on the person (`waitsOnUser` in `packages/web/src/view.ts`) but aren't in the accent anywhere but a chip. That's the biggest drift on this page; see below.

## When to use it

- **State chip:** beside a thread's title, in a list of threads, and on a workstream marked done ("Done Marked done 2 Nov"). Use the component, `StateChip` in `packages/web/src/parts.tsx`; never write its words yourself.
- **Status:** in an item's row, with its type mark and key. Use `Member` in `packages/web/src/parts.tsx` for an item in a workstream.
- **State dot:** in the sidebar's rows, or anywhere a row is too narrow for words. Pair it with the words somewhere close (the Needs you list puts the waiting word under the title).
- **Counts:** a quiet `.nav-count` after a label (a workstream's size, Done's count). The filled `.bar-count` only for the threads waiting on the person, on the control that shows them.
- **Preview badge:** to mark something as not finished, beside its name. Only Codex uses it.

## When not to

- Not the accent for anything that isn't the person's move. A busy agent, a count of items, a new thing: none of them is the accent.
- Not a filled count for anything but needs-you. A workstream's 12 items is a quiet number.
- Not a state chip for an item, or `.status` for a thread. They look alike, but their colours come from different maps.
- Not a dot alone where the state matters and nothing else says it. A dot's `title` is the only name some dots have, and a screen reader may not read it.
- Not as a button. `.overview-stat` is the one count that's also a control, and it looks like underlined text, not a pill.

## Anatomy and variants

### State chip

A pill, `--text-xs` medium, line-height 1.25rem, `0 var(--space-2)`, corner `--radius-lg`, its state's `-soft` fill and its state's colour (`.state-chip` in `window.css`).

```html specimen id=state-chip title="Every state chip a thread can show"
<div class="ws-row">
  <span class="state-chip" data-state="working" data-waiting="agent">Agent working</span>
  <span class="state-chip" data-state="working" data-waiting="apply">Applying…</span>
  <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
  <span class="state-chip" data-state="working" data-waiting="held">Message held</span>
  <span class="state-chip" data-state="working" data-waiting="stalled">Apply stalled</span>
  <span class="state-chip" data-state="working" data-waiting="draft">Draft to apply</span>
  <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
  <span class="state-chip" data-state="working">Working</span>
  <span class="state-chip" data-state="done">Done</span>
  <span class="state-chip" data-state="handed-off">Handed off</span>
  <span class="state-chip" data-state="dropped">Dropped</span>
</div>
```

```html specimen id=state-chip-in-a-list title="In a workstream's list of threads"
<ul class="thread-list">
  <li>
    <a class="thread-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0">
      <span class="thread-link-title">Estimate the unestimated checkout stories</span>
      <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
      <span class="thread-link-at"><time datetime="2026-11-04T09:12:00Z">2 h ago</time></span>
    </a>
  </li>
  <li>
    <a class="thread-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W1">
      <span class="thread-link-title">Draft the phone wallet stories</span>
      <span class="state-chip" data-state="working" data-waiting="agent">Agent working</span>
      <span class="thread-link-at"><time datetime="2026-11-04T08:40:00Z">3 h ago</time></span>
    </a>
  </li>
  <li>
    <a class="thread-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W2">
      <span class="thread-link-title">Which saved-card stories are blocked on design?</span>
      <span class="thread-link-at"><time datetime="2026-11-03T16:05:00Z">yesterday</time></span>
    </a>
  </li>
</ul>
```

A thread list leaves the chip out when the thread is in the state the list already says, so only the third row's state is implied (`Threads` in `packages/web/src/workstream-page.tsx`).

### Status and type mark

`.status` is the same pill as a state chip, but with `--radius-sm`: rounder or squarer corners depending on the theme (Broadsheet's `--radius-sm` is 0). The type mark is an 8px square in the type's colour; a bug is a dot, a doc a hollow square, a message a hollow bubble.

```html specimen id=status title="An item's status, by category, in a workstream's rows"
<ul class="members">
  <li class="member" data-item="jira:SYN-27">
    <span class="type" data-type="task" title="Task"></span>
    <a class="key source-link" href="https://example.atlassian.net/browse/SYN-27">SYN-27</a>
    <span class="member-title">Spike: NFC tap-to-board at the linkspan</span>
    <span class="status" data-category="todo">To Do</span>
  </li>
  <li class="member" data-item="jira:SYN-23">
    <span class="type" data-type="story" title="Story"></span>
    <a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a>
    <span class="member-title">Pay with a phone wallet on the website</span>
    <span class="status" data-category="in-progress">In Progress</span>
  </li>
  <li class="member" data-item="jira:SYN-22">
    <span class="type" data-type="story" title="Story"></span>
    <a class="key source-link" href="https://example.atlassian.net/browse/SYN-22">SYN-22</a>
    <span class="member-title">Give the map pins accessible labels</span>
    <span class="status" data-category="done">Done</span>
  </li>
  <li class="member" data-item="jira:SYN-37">
    <span class="type" data-type="bug" title="Bug"></span>
    <a class="key source-link" href="https://example.atlassian.net/browse/SYN-37">SYN-37</a>
    <span class="member-title">🐛 App crashes when rotating on the seat map</span>
    <span class="status" data-category="in-progress">In Progress</span>
  </li>
</ul>
```

```html specimen id=type title="Type marks: story, task, epic, bug, doc, message, and any other kind"
<div class="ws-row">
  <span class="type" data-type="story" title="Story"></span>
  <span class="type" data-type="task" title="Task"></span>
  <span class="type" data-type="epic" title="Epic"></span>
  <span class="type" data-type="bug" title="Bug"></span>
  <span class="type" data-type="doc" title="Doc"></span>
  <span class="type" data-type="message" title="Message"></span>
  <span class="type" data-type="spike" title="Spike"></span>
</div>
```

### Assignee

```html specimen id=assignee title="Initials, and nobody"
<div class="ws-row">
  <span class="assignee"><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span>
  <span class="assignee"><span class="avatar" aria-hidden="true">CY</span>Chen Yuting</span>
  <span class="assignee none"><span class="avatar" aria-hidden="true"></span>Unassigned</span>
</div>
```

### The sidebar's dots and waiting words

```html specimen id=state-dot title="Needs you, in the sidebar: a dot and the waiting word"
<ul class="nav-waiting">
  <li>
    <a class="nav-link nav-waiting-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0">
      <span class="state-dot" data-state="working" data-waiting="review"></span>
      <span class="nav-waiting-text">
        <span class="nav-name">Estimate the unestimated checkout stories</span>
        <span class="nav-waiting-about">
          <span class="nav-waiting-on" data-waiting="review">Needs review</span>
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </span>
      </span>
    </a>
  </li>
  <li>
    <a class="nav-link nav-waiting-link" href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W3">
      <span class="state-dot" data-state="working" data-waiting="reply"></span>
      <span class="nav-waiting-text">
        <span class="nav-name">Which gift card stories need a design?</span>
        <span class="nav-waiting-about">
          <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
          <span class="nav-waiting-workstream">Gift cards</span>
        </span>
      </span>
    </a>
  </li>
</ul>
```

```html specimen id=dots title="Every state dot, and the working dot"
<div class="ws-row">
  <span class="state-dot" data-state="working" data-waiting="agent" title="Agent working"></span>
  <span class="state-dot" data-state="working" data-waiting="review" title="Needs review"></span>
  <span class="state-dot" data-state="working" data-waiting="draft" title="Draft to apply"></span>
  <span class="state-dot" data-state="working" title="Working"></span>
  <span class="state-dot" data-state="done" title="Done"></span>
  <span class="state-dot" data-state="handed-off" title="Handed off"></span>
  <span class="state-dot" data-state="dropped" title="Dropped"></span>
  <span class="working-dot" title="2 agents working"></span>
</div>
```

### Counts

```html specimen id=counts title="Quiet counts: a workstream's size, Done's count, an overview section"
<div class="ws-stack">
  <a class="nav-link" href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0">
    <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
    <span class="working-dot" title="1 agent working"></span>
    <span class="nav-count" title="12 items">12</span>
  </a>
  <h2 class="overview-head"><span>Needs you</span><span class="overview-count">3</span></h2>
</div>
```

```html specimen id=bar-count title="The filled count: only threads waiting on you, on the control that shows them"
<button type="button" class="bar-menu" aria-controls="sidebar" aria-expanded="false">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </svg>
  <span class="visually-hidden">Open the sidebar, 3 threads waiting on you</span>
  <span class="bar-count" aria-hidden="true">3</span>
</button>
```

```html specimen id=overview-stats title="The overview's counts strip: two counts are buttons, two are text"
<p class="overview-counts" data-section="strip">
  <span class="overview-since">Since you looked Mon 2 Nov:</span>
  <button type="button" class="overview-stat" aria-expanded="false">
    <strong>14</strong> items changed
  </button>
  <span class="overview-stat"><strong>3</strong> workstreams moved</span>
  <button type="button" class="overview-stat" aria-controls="needs-you">
    <strong>3</strong> need you
  </button>
  <span class="overview-stat"><strong>27</strong> not in a workstream</span>
</p>
```

### Preview badge

```html specimen id=provider-badge title="An outlined pill: Codex's row in Settings"
<span class="provider-name">Codex<span class="provider-badge">Preview</span></span>
```

## States

None of these marks is interactive, except `.overview-stat` when it's a button.

```html specimen id=state-overview-stat title="A count that's a button: hover, focus, and none to show" state=hover
<p class="overview-counts" data-section="strip">
  <button type="button" class="overview-stat ws-hover" aria-expanded="false">
    <strong>14</strong> items changed
  </button>
  <button type="button" class="overview-stat ws-focus-visible" aria-controls="needs-you">
    <strong>3</strong> need you
  </button>
  <button type="button" class="overview-stat" disabled aria-expanded="false">
    <strong>0</strong> items changed
  </button>
</p>
```

- **Rest:** as above.
- **Hover:** only `button.overview-stat`, which turns the accent (`button.overview-stat:not(:disabled):hover` in `window.css`). The rows these marks sit in have their own hover.
- **Focus visible:** only `.overview-stat`, with the global ring.
- **Disabled:** an `.overview-stat` with a count of 0 is disabled and reads as plain text, with no dotted underline (`button.overview-stat:not(:disabled)` in `window.css`).
- **Busy:** the state dot pulses for Agent working and Applying… (`.state-dot:is([data-waiting="agent"], [data-waiting="apply"])` in `window.css`), held still under reduced motion (`@media (prefers-reduced-motion: reduce)` in `window.css`). The state chip doesn't pulse.
- **Empty:** Browse's row always renders `.status`, even for an item with no status, so it's an empty span with no `data-category` (`Item` in `packages/web/src/window-page.tsx`). It draws nothing, which is right, but write it as `Member` does: no span at all.
- **Error:** none of these says an error. A connection's red state is a status line; see [Connection row](/components/connection-row).

## Keyboard and ARIA

- None has a role. A state chip, a status and a waiting word are text, read in place.
- **Dots and type marks** carry their words only in `title`, which a screen reader may not read and a touch screen can't show. The sidebar's Needs you dots have no `title` at all, but the waiting word under them says it. Where a dot is alone, the row's other words must say what it means.
- **The filled count** is `aria-hidden="true"`, and the button that holds it says the whole thing in a `.visually-hidden` span: "Open the sidebar, 3 threads waiting on you". Copy that pairing.
- **The avatar** is `aria-hidden`; the name beside it is read.
- **`.overview-stat`** as a button sets `aria-expanded` (items changed opens what changed) or `aria-controls="needs-you"` (need you moves focus to the sidebar's Needs you). It's disabled at 0.
- A count's unit is in its words or its `title` ("12 items"), not in the number alone.

## Content

- A state chip says `waitingNames[waitingOn]`, or else `stateNames[state]` (`waitingNames` in `packages/web/src/parts.tsx`, `stateNames` in `packages/web/src/chip.ts`): Agent working, Message held, Draft to apply, Needs review, Applying…, Apply stalled, Your turn; Working, Done, Handed off, Dropped.
- A status is the source's own status name, as it says it: "In Progress", "In Review", "To Do". Its colour comes from the category, never the name.
- Initials are the first letters of the first and last words, upper-cased: Amara Okafor → AO (`initials` in `packages/web/src/parts.tsx`). Nobody is "Unassigned".
- Counts use `plural()` (`plural` in `packages/web/src/parts.tsx`): "1 item", "12 items". The overview's strip: "Since you looked Mon 2 Nov:" or "In the last 90 days:", then "14 items changed", "3 workstreams moved", "3 need you" (1 needs you), "27 not in a workstream".
- The preview badge says "Preview", nothing longer.

## Where the app uses it

- `.state-chip` in `window.css`; `StateChip` in `packages/web/src/parts.tsx`, used by `ThreadPage` in `packages/web/src/thread-page.tsx`, and `WorkstreamPage` and `Threads` in `packages/web/src/workstream-page.tsx`.
- `.status` in `window.css`; `Member` in `packages/web/src/parts.tsx` and, a second copy, `Item` in `packages/web/src/window-page.tsx`.
- `.state-dot` in `window.css`; `NeedsYou`, `WorkstreamEntry` and `Done` in `packages/web/src/sidebar.tsx`. `.nav-waiting-on` in `window.css`; `NeedsYou` in `packages/web/src/sidebar.tsx`. `.working-dot` in `window.css`; `WorkstreamEntry` in `packages/web/src/sidebar.tsx`.
- `.type` in `window.css`; `TypeMark` in `packages/web/src/parts.tsx`, and a second copy, `Item` in `packages/web/src/window-page.tsx`.
- `.assignee` and `.avatar` in `window.css`; `Assignee` in `packages/web/src/parts.tsx`.
- `.bar-count` in `window.css`; `Bar` in `packages/web/src/app.tsx` and `Sidebar` in `packages/web/src/sidebar.tsx`.
- `.nav-count` in `window.css`; `WorkstreamEntry` in `packages/web/src/sidebar.tsx`, `DonePage` in `packages/web/src/other-pages.tsx`. `.overview-count` in `window.css`; `Section` in `packages/web/src/overview-page.tsx`. `.overview-stat` in `window.css`; `Counts` in `packages/web/src/overview-page.tsx`.
- `.provider-badge` in `window.css`; `ProviderRow` in `packages/web/src/provider-row.tsx`.

## Drift

Status **drifting**. The marks are each fine; what drifts is how a state becomes a colour, and how a number looks.

- **Five state-to-colour maps** (`.state-chip`, `.state-dot`, `.nav-waiting-on`, `.chip`, `.status`), and the connection rows' a sixth. They disagree: Draft to apply and Your turn are the person's move but show in the in-progress colour everywhere but a chip; a dropped thread's state chip has no rule and shows as grey to do; only the dot pulses.
- **Two pills for one idea:** `.state-chip` has `--radius-lg`, `.status` `--radius-sm`. They often sit in the same list.
- **Seven quiet counts** (`.nav-count`, `.overview-count`, `.count`, `.more-count`, `.selection-count` and `.change-set-count`): faint or muted, tabular or not. The filled `.bar-count` is written twice: `Bar` in `packages/web/src/app.tsx` and `Sidebar` in `packages/web/src/sidebar.tsx`.
- `.type` and `.status` are written by hand in Browse instead of through `TypeMark` and `Member`.

**Until it's consolidated:** for a thread's state, use `StateChip`, and don't add a state to its CSS without adding it to the dot, the waiting word and the chip in the same change. For an item, use `Member`, or `TypeMark` and the `.status` span as `Member` writes them. For a quiet number, use `.nav-count`. Don't use the accent for a new state unless it's the person's move, and ask the maintainer before moving Draft to apply and Your turn into it. The proposals (one `Tone` map, a `Tag`, a `Dot` and a `Count`) are in [the drift report](/drift) as cms:A1 to cms:A4.
