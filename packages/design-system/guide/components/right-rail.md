---
title: Right rail
status: stable
group: Surfaces
order: 61
classes: thread-layout, thread, rail, rail-title, rail-note, rail-note-end, sync-now, members, compact, member, member-title, gone, type, key, source-link, item-link, status, replies, icon
summary: The column beside a thread's chat that lists the items the thread works on, at one version of its workstream, with Sync now when the workstream has moved on.
---

# Right rail

## What it is

The column on the right of a thread's page: "the region this thread works in" (`.rail` in `window.css`). A thread works on its workstream's items as they were at one version. The rail says how many items and which version ("17 items · v3"), lists them, and says when the workstream has moved on since.

"Behind it, the thread catches up with the next message, or with Sync now, which waits while a turn runs: the turn works in the version it started in" (`Region` in `packages/web/src/thread-page.tsx`).

It is an `aside.rail` labelled "This thread's items", the second column of `.thread-layout` beside `main.thread`. Its rows are the same `Member` rows a workstream's page lists, drawn compact: a type mark, a key and a title, with no status and no Remove.

There is no generated summary in the rail. It holds the title line, at most one note, and the items; nothing an agent wrote.

## When to use it

- On a thread's page, always, including a new thread before its first message, where it holds the workstream picker, with the new workstream's title under it while the picker is on "New workstream", and the picked workstream's count once one with items is picked.
- To show which items a question in the thread is about. Each row opens its item in the [item panel](/components/item-panel), with Previous and Next through the rail's list.
- To say the thread is behind its workstream, and offer Sync now.

## When not to

- Not for a workstream's page. That page lists its items full width, with status and Remove, as a framed [list](/components/list-row) (`ul.members` without `.compact`).
- Not for anything but the region: no thread actions, no change sets, no notes from the agent. A change set lives in the chat; see [Change set](/components/change-set).
- Don't reuse `.rail-title` expecting the rail's look. The same class is the sidebar's small-caps heading; see Drift.

## Anatomy and variants

1. **Title** (`h2.rail-title`): "{N} items · v{version}" in small caps, faint, one `--head-row` tall so it lines up with the crumb on the left.
2. **Note** (`p.rail-note`), at most one: behind its workstream, with Sync now at the end of its last word; or the empty line.
3. **Items** (`ul.members.compact`): one `li.member` per item, a grid of the type mark (0.5rem), the key and the title, 1.75rem tall, `--text-sm`, with no frame and no separators. The status is hidden. A Slack message's replies take a column of their own (`grid-auto-flow: column`).
4. **Not in the index** (`li.member.gone`): an item the index no longer has. Its title is its last known one, or "Not in the index", faint and italic, and its type mark is the plain grey square.

```html specimen id=layout screen height=560 title="Beside the chat, on a wide page (a 1280 screen, page only)"
<div class="thread-layout">
  <main class="thread">
    <header class="thread-head">
      <a class="crumb" href="/workstreams/checkout-v2"
        >Checkout v2: phone wallets and saved cards</a
      >
      <div class="thread-title-row">
        <h1 class="thread-title" tabindex="-1">Which stories here still need estimates?</h1>
        <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
        <button type="button" class="quiet-action">Mark done</button>
      </div>
    </header>
    <ol class="chat">
      <li class="user-message">Which stories here still need estimates?</li>
      <li class="reply">
        <p>I'll find stories here without an estimate and propose 3 points for each.</p>
      </li>
    </ol>
  </main>
  <aside class="rail" aria-label="This thread's items">
    <h2 class="rail-title">17 items · v3</h2>
    <ul class="members compact">
      <li class="member">
        <span class="type" data-type="epic" title="Epic"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-1">SYN-1</a
        ><span class="member-title">Checkout v2: phone wallets and saved cards</span
        ><span class="status" data-category="in-progress">In Progress</span>
      </li>
      <li class="member">
        <span class="type" data-type="task" title="Task"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-10">SYN-10</a
        ><span class="member-title">Remove the legacy web-view checkout</span
        ><span class="status" data-category="todo">To Do</span>
      </li>
      <li class="member">
        <span class="type" data-type="story" title="Story"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a
        ><span class="member-title">Pay with a phone wallet on the website</span
        ><span class="status" data-category="in-progress">In Progress</span>
      </li>
      <li class="member">
        <span class="type" data-type="story" title="Story"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-41">SYN-41</a
        ><span class="member-title">Receipt email: include the vehicle registration</span
        ><span class="status" data-category="done">Done</span>
      </li>
      <li class="member">
        <span class="type" data-type="bug" title="Bug"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-74">SYN-74</a
        ><span class="member-title">Card form loses focus after autofill</span
        ><span class="status" data-category="done">Done</span>
      </li>
      <li class="member">
        <span class="type" data-type="message" title="Message"></span
        ><a class="key source-link" href="https://example.slack.com/archives/C01/p1">Message</a
        ><span class="member-title">Dara Nikolaidis: Decision: when a sailing is cancelled…</span
        ><a class="replies source-link" href="https://example.slack.com/archives/C01/p1"
          >4 replies</a
        >
      </li>
      <li class="member gone">
        <span class="type" data-type=""></span
        ><button type="button" class="key source-link item-link">SYN-900</button
        ><span class="member-title">Not in the index</span>
      </li>
    </ul>
  </aside>
</div>
```

```html specimen id=behind screen height=300 title="Behind its workstream: the note, with Sync now after its last word"
<div class="thread-layout">
  <main class="thread">
    <header class="thread-head">
      <a class="crumb" href="/workstreams/checkout-v2"
        >Checkout v2: phone wallets and saved cards</a
      >
      <div class="thread-title-row">
        <h1 class="thread-title" tabindex="-1">What's in here?</h1>
        <span class="state-chip" data-state="done">Done</span>
      </div>
    </header>
  </main>
  <aside class="rail" aria-label="This thread's items">
    <h2 class="rail-title">16 items · v2</h2>
    <p class="rail-note">
      Workstream will update on next
      <span class="rail-note-end"
        >send<button
          type="button"
          class="sync-now"
          aria-label="Sync this thread with its workstream"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
            />
            <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
          </svg></button
        ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
          >Sync this thread with its workstream</span
        ></span
      >
    </p>
    <ul class="members compact">
      <li class="member">
        <span class="type" data-type="epic" title="Epic"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-1">SYN-1</a
        ><span class="member-title">Checkout v2: phone wallets and saved cards</span>
      </li>
      <li class="member">
        <span class="type" data-type="story" title="Story"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a
        ><span class="member-title">Pay with a phone wallet on the website</span>
      </li>
      <li class="member">
        <span class="type" data-type="story" title="Story"></span
        ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-99">SYN-99</a
        ><span class="member-title">Save a card for next time</span>
      </li>
    </ul>
  </aside>
</div>
```

```html specimen id=empty title="Empty: a thread on an empty workstream, and a new thread before its first message (each rail at the frame's width)"
<div class="ws-stack">
  <aside class="rail" aria-label="This thread's items">
    <h2 class="rail-title">0 items · v1</h2>
    <p class="rail-note">No items yet. What a change set here creates joins this workstream.</p>
    <ul class="members compact"></ul>
  </aside>
  <aside class="rail" aria-label="This thread's items">
    <label class="filter new-thread-workstream" data-at="rail">
      <span class="visually-hidden">Workstream</span>
      <select>
        <option value="" selected>New workstream</option>
        <option value="ws-2">Gift cards</option>
      </select>
    </label>
  </aside>
</div>
```

```html specimen id=narrow width=390 pad=0 title="A narrow page (≤932px): the rail as it sits under the chat, its rows become keys"
<div class="shell-main">
  <div class="thread-layout">
    <aside class="rail" aria-label="This thread's items">
      <h2 class="rail-title">6 items · v3</h2>
      <ul class="members compact">
        <li class="member">
          <span class="type" data-type="epic" title="Epic"></span
          ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-1">SYN-1</a
          ><span class="member-title">Checkout v2: phone wallets and saved cards</span>
        </li>
        <li class="member">
          <span class="type" data-type="task" title="Task"></span
          ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-10">SYN-10</a
          ><span class="member-title">Remove the legacy web-view checkout</span>
        </li>
        <li class="member">
          <span class="type" data-type="story" title="Story"></span
          ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a
          ><span class="member-title">Pay with a phone wallet on the website</span>
        </li>
        <li class="member">
          <span class="type" data-type="story" title="Story"></span
          ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-41">SYN-41</a
          ><span class="member-title">Receipt email: include the vehicle registration</span>
        </li>
        <li class="member">
          <span class="type" data-type="bug" title="Bug"></span
          ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-74">SYN-74</a
          ><span class="member-title">Card form loses focus after autofill</span>
        </li>
        <li class="member gone">
          <span class="type" data-type=""></span
          ><button type="button" class="key source-link item-link">SYN-900</button
          ><span class="member-title">Not in the index</span>
        </li>
      </ul>
    </aside>
  </div>
</div>
```

**Wide.** At 1280px and up (`@media (min-width: 1280px)` in `window.css`), where the column beside it stays wider than a narrow page with the sidebar open, the rail leaves the page: it's fixed at the window's right edge, the window's height, `--rail-beside` wide (the rail and the sidebar's `--space-3` each side), on `--frame`, as the sidebar is on the left, and `.shell:has(.rail)` sets `--beside` to its width, so the page column sits inset between the two and the chat has it to itself (2026-11-08). The [item panel](/components/item-panel) covers it while it's open.

**Narrow.** Below 1280px: "A narrow page, on a narrow screen or beside the panel: the rails move inline, and rows wrap to two lines. The region moves under the chat before the rows wrap, where a 1180px screen leaves the page beside the sidebar" (`@container page (max-width: 932px)` in `window.css`). Under `@container page (max-width: 932px)` the layout is one column, the rail is no longer sticky, and its rows become a wrapping line of type marks and keys, titles hidden. The workshop's frames are `page` containers too, so any rail specimen narrower than 932px draws this form. The container is `.shell-main`, so opening the [item panel](/components/item-panel) beside the page can move the rail under the chat on a wide screen.

## States

```html specimen id=state-sync title="Sync now: rest, hover, focus, waiting on a turn, and syncing" state=rest
<div class="ws-stack">
  <p class="rail-note">
    Rest: Workstream will update on next
    <span class="rail-note-end"
      >send<button type="button" class="sync-now" aria-label="Sync this thread with its workstream">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-note">
    Hover: Workstream will update on next
    <span class="rail-note-end"
      >send<button
        type="button"
        class="sync-now ws-hover"
        aria-label="Sync this thread with its workstream"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-note">
    Focus visible: Workstream will update on next
    <span class="rail-note-end"
      >send<button
        type="button"
        class="sync-now ws-focus-visible"
        aria-label="Sync this thread with its workstream"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-note">
    Waiting, a turn runs: Workstream will update on next
    <span class="rail-note-end"
      >send<button
        type="button"
        class="sync-now"
        aria-label="Sync this thread with its workstream"
        aria-disabled="true"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
      ><span role="tooltip" popover="manual" class="tooltip"
        >Syncs once the agent has answered</span
      ></span
    >
  </p>
  <p class="rail-note">
    Syncing: Workstream will update on next
    <span class="rail-note-end"
      >send<button
        type="button"
        class="sync-now"
        aria-label="Sync this thread with its workstream"
        aria-disabled="true"
        aria-busy="true"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
      ><span role="tooltip" popover="manual" class="tooltip">Syncing…</span></span
    >
  </p>
</div>
```

```html specimen id=state-row-focus title="A row's key, hovered and focused (the list alone, at a wide rail's row shape)" state=focus-visible
<ul class="members compact">
  <li class="member">
    <span class="type" data-type="story" title="Story"></span
    ><a class="key source-link ws-hover" href="https://example.atlassian.net/browse/SYN-23"
      >SYN-23</a
    ><span class="member-title">Pay with a phone wallet on the website</span>
  </li>
  <li class="member">
    <span class="type" data-type="story" title="Story"></span
    ><a class="key source-link ws-focus-visible" href="https://example.atlassian.net/browse/SYN-99"
      >SYN-99</a
    ><span class="member-title">Save a card for next time</span>
  </li>
</ul>
```

- **Rest** is the title and the list. The rows aren't hover targets: only the key is a link, and it turns accent and underlined on hover (`.source-link:hover` in `window.css`). **Focus-visible** on a key or on Sync now is the global ring.
- **Hover** on Sync now is `--surface-hover` behind `--text`, only while it can act (`.sync-now:hover:not([aria-disabled])` in `window.css`).
- **Disabled** is `aria-disabled="true"` on Sync now, at 0.5, while a turn runs or a sync is under way (`.sync-now[aria-disabled]` in `window.css`). It stays in the tab order so its tooltip can say why; clicks do nothing.
- **Busy**: syncing sets `aria-busy="true"` too, and the icon pulses (`.sync-now[aria-busy] .icon` in `window.css`), and holds still under reduced motion. The tooltip says "Syncing…".
- **Stale** is the behind note itself: the region's version is older than the workstream's.
- **Empty**: "No items yet. What a change set here creates joins this workstream." under "0 items · v1". A new thread's rail says nothing of items: a new thread never has its own, so it holds only the workstream picker, and the picked workstream's count once one with items is picked. The behind note wins over the empty one. Oriel's thread for moving the stand-in tracker's issues into a tracker that turned on says, in place of the empty note, "What this change creates goes to the workstreams that hold the issues it makes again.", and once it applied, "Its items went to {workstreams}." (decision 0059, OA-278); its own workstream then ends, done.
- **Error** and **loading** have no look of their own: the rail comes with the thread's page, which has its own loading and error lines.
- **Active** isn't styled.

## Keyboard and ARIA

- `aside.rail` with `aria-label="This thread's items"`, after the chat in the source, so Tab reaches it after the composer.
- Each key is the item's link. A plain click or Enter opens the [item panel](/components/item-panel); the rail's ids are its list, so ↑ and ↓ step through them there. Cmd/Ctrl-click opens the source. An item with no web page is a `button.item-link` that opens only in the panel.
- Sync now is a `button` labelled "Sync this thread with its workstream". It uses `aria-disabled`, not `disabled`, so it keeps focus and its [tooltip](/components/tooltip): "Sync this thread with its workstream", "Syncs once the agent has answered" while a turn runs, "Syncing…" while it syncs. `aria-busy` marks the sync.
- The behind note isn't a live region: it appears when the page learns the workstream moved, without an announcement.

## Content

- Title: "{N} items · v{version}" by `plural()`, so "1 item · v1". Shown in small caps by the class; write it in sentence case.
- Behind: "Workstream will update on next send", with Sync now after "send", which it never leaves (`.rail-note-end` is `nowrap`).
- Empty: the two lines above, quoted exactly.
- A gone item: its last known title, or "Not in the index".
- Keys are the source's keys, as `keyLabel` writes them: "SYN-23", or "Message" for a Slack message.

## Where the app uses it

- `Region` in `packages/web/src/thread-page.tsx`, rendered by `ThreadPage`. The new thread's rail: `NewThreadPage` in `packages/web/src/thread-page.tsx`.
- Rows: `Member` in `packages/web/src/parts.tsx`, without `onRemove`.
- CSS: `.thread-layout`, `.rail`, `.rail > .rail-title`, `.rail-note`, `.rail-note-end` and `.sync-now` in `window.css`; the compact rows, `.members.compact` in `window.css`; the shared `.rail-title` in `window.css`; and the narrow form, under `@container page (max-width: 932px)` in `window.css`.

Two small inconsistencies, neither worth a drift status of its own:

- `.rail-title` is both this sentence ("17 items · v3") and the sidebar's section label ("Workstreams"); they share one look by accident of a class name.
- A gone item with no URL renders its key as `button.key.source-link.item-link`, and `.item-link`'s `color: inherit` (`.item-link` in `window.css`) beats `.key`'s faint colour, so "SYN-900" reads darker than the live keys above it (as in the app's own screenshots).
