---
title: Right rail
status: stable
group: Surfaces
order: 61
classes: thread-layout, thread, rail, rail-title, rail-sync, rail-sync-end, rail-note, sync-now, members, compact, member, member-title, gone, type, key, source-link, item-link, status, replies, icon
summary: The column beside a thread's chat that lists the items the thread works on, at one version of its workstream, when it last synced with it, and Sync workstream now when the workstream has moved on. The window chat's rail sits at the same edge, in the same material.
---

# Right rail

## What it is

The column on the right of a thread's page: "the region this thread works in" (`.rail` in `window.css`). A thread works on its workstream's items as they were at one version. The rail says how many items its workstream holds and at which version ("17 items · v3"), when the thread last synced with it ("Synced 2 min ago"), and lists the thread's items; once the workstream has moved on since, it offers Sync workstream now.

"Behind it, the thread catches up with the next message, or with Sync workstream now, which waits while a turn runs: the turn works in the version it started in" (`Region` in `packages/web/src/thread-page.tsx`).

It is an `aside.rail` labelled "This thread's items", the second column of `.thread-layout` beside `main.thread`. Its rows are the same `Member` rows a workstream's page lists, drawn compact: a type mark, a key and a title, with no status and no Remove.

There is no generated summary in the rail. It holds the title line, at most one note, and the items; nothing an agent wrote.

## When to use it

- On a thread's page, always, including a new thread before its first message, where it holds the workstream picker, with the new workstream's title under it while the picker is on "New workstream", and the picked workstream's count once one with items is picked.
- To show which items a question in the thread is about. Each row opens its item in the [item panel](/components/item-panel), with Previous and Next through the rail's list.
- To say when the thread last synced with its workstream, and, behind it, offer Sync workstream now.

## When not to

- Not for a workstream's page. That page lists its items full width, with status and Remove, as a framed [list](/components/list-row) (`ul.members` without `.compact`).
- Not for anything but the region: no thread actions, no change sets, no notes from the agent. A change set lives in the chat; see [Change set](/components/change-set).
- Don't reuse `.rail-title` expecting the rail's look. The same class is the sidebar's small-caps heading; see Drift.

## Anatomy and variants

1. **Title** (`h2.rail-title`): "{N} items · v{version}", the workstream as it is now, in small caps, faint, one `--head-row` tall so it lines up with the crumb on the left.
2. **Sync line** (`p.rail-sync`): "Synced 2 min ago", the time as Settings' time format writes it, its date and time on hover (`Stamp`). Behind its workstream, **Sync workstream now** (`button.sync-now`, the sync icon, its name in its tooltip) follows the time, which it never leaves (`.rail-sync-end` is `nowrap`).
3. **Note** (`p.rail-note`), at most one: the empty line, or a move's line.
4. **Items** (`ul.members.compact`): one `li.member` per item, a grid of the type mark (0.5rem), the key and the title, 1.75rem tall, `--text-sm`, with no frame and no separators. The status is hidden. A Slack message's replies take a column of their own (`grid-auto-flow: column`).
5. **Not in the index** (`li.member.gone`): an item the index no longer has. Its title is its last known one, or "Not in the index", faint and italic, and its type mark is the plain grey square.

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
    <p class="rail-sync">Synced <time datetime="2026-11-10T09:58:00Z">2 min ago</time></p>
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

```html specimen id=behind screen height=300 title="Behind its workstream: Sync workstream now after the time"
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
    <h2 class="rail-title">17 items · v3</h2>
    <p class="rail-sync">
      Synced
      <span class="rail-sync-end"
        ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
        ><button type="button" class="sync-now" aria-label="Sync workstream now">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
            />
            <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
          </svg></button
        ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
          >Sync workstream now</span
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
    <p class="rail-sync">Synced <time datetime="2026-11-10T09:58:00Z">2 min ago</time></p>
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
      <p class="rail-sync">Synced <time datetime="2026-11-10T09:58:00Z">2 min ago</time></p>
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

**Wide.** At 1280px and up (`@media (min-width: 1280px)` in `window.css`), where the column beside it stays wider than a narrow page with the sidebar open, the rail leaves the page: it's fixed at the window's right edge, the window's height, `--rail-beside` wide, which with the frame's band beside the column makes it as wide as the open sidebar (`--sidebar-open`), its sides the sidebar's `--space-3` mirrored (the band counts in its inner side), on `--frame`, as the sidebar is on the left, so the two read as a pair, and `.shell:has(.rail)` sets `--beside` to its width, so the page column sits inset between the two and the chat has it to itself (2026-11-08). The [item panel](/components/item-panel) covers it while it's open.

**Narrow.** Below 1280px: "A narrow page, on a narrow screen or beside the panel: the rails move inline, and rows wrap to two lines. The region moves under the chat before the rows wrap, where a 1180px screen leaves the page beside the sidebar" (`@container page (max-width: 932px)` in `window.css`). Under `@container page (max-width: 932px)` the layout is one column, the rail is no longer sticky, and its rows become a wrapping line of type marks and keys, titles hidden. The workshop's frames are `page` containers too, so any rail specimen narrower than 932px draws this form. The container is `.shell-main`, so opening the [item panel](/components/item-panel) beside the page can move the rail under the chat on a wide screen.

## The window chat's rail

The window chat is a rail too, at the same edge in the same material: once the person asks, on the window (the overview or Browse), it opens at the window's right edge (`.window-chat` in `window.css`, decision 0030), and the page column narrows for it rather than lying under it. It's a different rail from a thread's, holding a conversation rather than a region, but it's built to sit there the same way:

- **Where:** `position: fixed`, the window's full height, `--chat-rail` wide (24rem; 22rem under 1280px). At 1100px and up `.shell[data-chat]` sets `--beside` to it, so the overview stays whole beside the chat, as a thread's page sits beside its rail.
- **Material:** `--frame`, with no border and no shadow, as a thread's rail and the sidebar are. Its first line starts below the bead's resting place, as the page's does.
- **Head:** **Chat** (`h2.rail-title.window-chat-title`, this rail's title look), Open as a thread, New chat, and the fold, Hide the chat. See [Thread messages](/components/message#the-window-chat-s-head).
- **Entries**, which scroll, then the composer at its foot, raised. See [Chat input](/components/chat-input).
- **An item opened** takes the rail's place, as wide (`--panel: var(--chat-rail)`), and carries the composer in its dock. Closing the item brings the rail back. See [Item panel](/components/item-panel#the-dock).
- **Under 1100px** there's no rail: the chat is a sheet over the page's foot, 45vh, or 85vh with its grab bar (`button.window-chat-grab`, "Make the chat taller" or "Make the chat shorter"). A drag up makes it tall, down makes it short, and down from short hides it; a press, Enter or Space goes between the two. On a phone it's edge to edge. See [Layout](/foundations/layout#the-shell).
- **Motion:** opening and folding with no item open carries the composer between the page's foot and the rail, while the rail comes in from the edge. See [Motion A](/foundations/motion#motion-a-the-composer-carried).

```html specimen id=window-chat-rail screen height=520 title="The window chat's rail, on a 1280 screen (the rail only)"
<aside class="window-chat" aria-label="The window chat">
  <header class="window-chat-head">
    <h2 class="rail-title window-chat-title">Chat</h2>
    <a href="/threads/t-41" class="quiet-action">Open as a thread</a>
    <button type="button" class="quiet-action">New chat</button>
    <button type="button" class="sidebar-fold window-chat-fold" aria-label="Hide the chat">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M10 2.5v11" />
      </svg>
    </button>
  </header>
  <ol class="chat window-chat-entries">
    <li class="user-message">What changed in Checkout v2 this week?</li>
    <li class="reply">
      <p>Two stories moved to Done, and SYN-74 was reopened after a failed test.</p>
    </li>
  </ol>
  <form class="chat-input" data-elevation="raised">
    <textarea
      class="chat-input-field"
      rows="2"
      placeholder="Ask a follow-up"
      aria-label="Message"
    ></textarea>
    <div class="chat-input-foot">
      <span class="chat-input-reads">Reads your whole window</span>
      <button type="submit" class="button" disabled>Send</button>
    </div>
  </form>
</aside>
```

## States

```html specimen id=state-sync title="Sync workstream now: rest, hover, focus, waiting on a turn, and syncing" state=rest
<div class="ws-stack">
  <p class="rail-sync">
    Rest: Synced
    <span class="rail-sync-end"
      ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
      ><button type="button" class="sync-now" aria-label="Sync workstream now">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-sync">
    Hover: Synced
    <span class="rail-sync-end"
      ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
      ><button type="button" class="sync-now ws-hover" aria-label="Sync workstream now">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-sync">
    Focus visible: Synced
    <span class="rail-sync-end"
      ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
      ><button type="button" class="sync-now ws-focus-visible" aria-label="Sync workstream now">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.75 8a5.25 5.25 0 0 1 9.5-3.1l1.25 1.6M13.25 8a5.25 5.25 0 0 1-9.5 3.1L2.5 9.5"
          />
          <path d="M13.5 2.5v4h-4M2.5 13.5v-4h4" />
        </svg></button
    ></span>
  </p>
  <p class="rail-sync">
    Waiting, a turn runs: Synced
    <span class="rail-sync-end"
      ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
      ><button type="button" class="sync-now" aria-label="Sync workstream now" aria-disabled="true">
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
  <p class="rail-sync">
    Syncing: Synced
    <span class="rail-sync-end"
      ><time datetime="2026-11-10T09:58:00Z">2 min ago</time
      ><button
        type="button"
        class="sync-now"
        aria-label="Sync workstream now"
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

- **Rest** is the title and the list. The rows aren't hover targets: only the key is a link, and it turns accent and underlined on hover (`.source-link:hover` in `window.css`). **Focus-visible** on a key or on Sync workstream now is the global ring.
- **Hover** on Sync workstream now is `--surface-hover` behind `--text`, only while it can act (`.sync-now:hover:not([aria-disabled])` in `window.css`).
- **Disabled** is `aria-disabled="true"` on Sync workstream now, at 0.5, while a turn runs or a sync is under way (`.sync-now[aria-disabled]` in `window.css`). It stays in the tab order so its tooltip can say why; clicks do nothing.
- **Busy**: syncing sets `aria-busy="true"` too, and the icon pulses (`.sync-now[aria-busy] .icon` in `window.css`), and holds still under reduced motion. The tooltip says "Syncing…".
- **Stale**: the region's version is older than the workstream's. The title already says the workstream's count and version, the list still the thread's items, and Sync workstream now follows the time; once it syncs, the list catches up.
- **Empty**: "No items yet. What a change set here creates joins this workstream." under "0 items · v1" and the sync line. A new thread's rail says nothing of syncing or of items: a new thread never has its own, so it holds only the workstream picker, and the picked workstream's count once one with items is picked. Behind its workstream, Sync workstream now shows in place of the empty note. Oriel's thread for moving the stand-in tracker's issues into a tracker that turned on says, in place of the empty note, "What this change creates goes to the workstreams that hold the issues it makes again.", and once it applied, "Its items went to {workstreams}." (decision 0059, OA-278); its own workstream then ends, done.
- **Error** and **loading** have no look of their own: the rail comes with the thread's page, which has its own loading and error lines.
- **Active** isn't styled.

## Keyboard and ARIA

- `aside.rail` with `aria-label="This thread's items"`, after the chat in the source, so Tab reaches it after the composer.
- Each key is the item's link. A plain click or Enter opens the [item panel](/components/item-panel); the rail's ids are its list, so ↑ and ↓ step through them there. Cmd/Ctrl-click opens the source. An item with no web page is a `button.item-link` that opens only in the panel.
- Sync workstream now is a `button` labelled "Sync workstream now". It uses `aria-disabled`, not `disabled`, so it keeps focus and its [tooltip](/components/tooltip): "Sync workstream now", "Syncs once the agent has answered" while a turn runs, "Syncing…" while it syncs. `aria-busy` marks the sync.
- The behind note isn't a live region: it appears when the page learns the workstream moved, without an announcement.

## Content

- Title: "{N} items · v{version}" by `plural()`, so "1 item · v1": the workstream's count and version now, never a second number elsewhere in the rail (the maintainer, 2026-11-10). Shown in small caps by the class; write it in sentence case.
- Synced: "Synced {time}", the time by `Stamp` as Settings' time format writes it ("Synced just now", "Synced 2 min ago", or a date and time), its date and time on hover; the time moves on each minute while the page is open. It's when the thread last moved to its workstream's version: its last marker, or when it opened (`syncedAt`).
- Behind: the same "Synced {time}", with the sync icon after the time; its tooltip, "Sync workstream now", is its name.
- Empty: the two lines above, quoted exactly.
- A gone item: its last known title, or "Not in the index".
- Keys are the source's keys, as `keyLabel` writes them: "SYN-23", or "Message" for a Slack message.

## Where the app uses it

- `Region` in `packages/web/src/thread-page.tsx`, rendered by `ThreadPage`. The new thread's rail: `NewThreadPage` in `packages/web/src/thread-page.tsx`.
- Rows: `Member` in `packages/web/src/parts.tsx`, without `onRemove`.
- The window chat's rail: `WindowChat` in `packages/web/src/window-chat-view.tsx`, rendered by `App` in `packages/web/src/app.tsx` while the chat is open on the window and no item is open (or it's folded); CSS `.window-chat`, `.shell[data-chat]` and `.window-chat-grab` in `window.css`.
- CSS: `.thread-layout`, `.rail`, `.rail > .rail-title`, `.rail-sync`, `.rail-sync-end`, `.rail-note` and `.sync-now` in `window.css`; the compact rows, `.members.compact` in `window.css`; the shared `.rail-title` in `window.css`; and the narrow form, under `@container page (max-width: 932px)` in `window.css`.

Two small inconsistencies, neither worth a drift status of its own:

- `.rail-title` is both this sentence ("17 items · v3") and the sidebar's section label ("Workstreams"); they share one look by accident of a class name.
- A gone item with no URL renders its key as `button.key.source-link.item-link`, and `.item-link`'s `color: inherit` (`.item-link` in `window.css`) beats `.key`'s faint colour, so "SYN-900" reads darker than the live keys above it (as in the app's own screenshots).
