---
title: Item panel
status: stable
group: Surfaces
order: 60
classes: item-panel, panel-steps, panel-step, panel-place, panel-head, panel-source, panel-close, panel-title, panel-actions, panel-open, panel-added, panel-problem, panel-read, panel-behind, panel-note, panel-body, panel-facts, panel-fact, panel-heading, panel-plain, panel-prose, reply, panel-messages, panel-thread, panel-message, panel-day, panel-said, panel-author, panel-label, panel-files, panel-file, panel-edited, panel-empty, mention, item-link, avatar
summary: The panel beside the page that shows one item in its source's own view, read live, with Open in its source and Add to workstream.
---

# Item panel

## What it is

The panel beside the page: "an item in its source's own view, read live, as Oriel's own elements" (`packages/web/src/item-panel.tsx`). Any item link opens it: a key in a list, a chip in an answer, a row in the right rail. A plain click opens the panel; Cmd/Ctrl, Shift or a middle click goes to the source instead (`ItemLink` in `packages/web/src/parts.tsx`).

It reads the item from its source when it opens, so what it shows is the source's, not the index's. A source returns typed blocks, never HTML: facts, text, rich text, messages and notes. "Nothing here sets HTML" (`packages/web/src/item-panel.tsx`).

There is one panel. It belongs to the shell (`div.shell[data-panel]`), not to a page, so it stays open as the page under it changes.

## When to use it

- To show one item without leaving the page: every item link opens it by default. Write item links with `ItemLink` or `ItemKey` in `packages/web/src/parts.tsx`, and the panel comes with them.
- When the link is in a list, put the list's ids in `ItemListContext`. The panel then gets Previous and Next and its place ("4 of 14"), and ↑ and ↓ step through the list. An answer is a list too: the items it names as chips, in its order ("1 of 2"), so the panel steps through what the answer named (`Reply` in `packages/web/src/thread-page.tsx`).
- The chip for the open item is marked while it's open (`OpenItemContext` in `packages/web/src/parts.tsx`); see [Chip](/components/chip).
- When the page is about a workstream (its own page, a thread's page, or Browse adding to one), the panel offers **Add to workstream** for that workstream (`currentWorkstream` in `packages/web/src/root.ts`). Nothing else needs doing.

## When not to

- Not for anything that isn't an item. A thread, a workstream or a change set is a page. The window chat has its own panel-shaped surface (`.window-chat`). At 1100px and up, an item opened while it's open takes the window's edge and the chat moves into the page column beside it, with "‹ Window" to put the overview back (the item stays open). From 1100 to 1279px the item narrows so the chat keeps 28rem. Below 1100px the item covers the chat, and carries its composer in a dock (see [The dock](#the-dock-over-a-conversation-below-1100px)).
- Not as a second dialog. It doesn't trap focus and doesn't dim the page. A question that must be answered first is a [confirm](/components/confirm).
- Not for editing the item. The panel reads; changes to an item go through a change set in a thread. A stand-in's item is the one exception, edited in place in its [form](/components/stand-in-panel).
- Don't nest a list of items in it that opens items in it. A moved item's new key is a link that replaces what the panel shows, which is fine; a list of twenty is Browse's job.

## Anatomy and variants

From the top:

1. **Steps** (`nav.panel-steps`), only when opened from a list: Previous, the place ("4 of 14"), Next. Absolutely placed beside Close, outside the per-item content, so it stays put and keeps focus while the item under it changes (`.panel-steps` in `window.css`).
2. **Head** (`header.panel-head`): the source and key ("Jira · SYN-23"), Close (×), the title in `--font-heading` at `--text-xl` and `--title-weight`, then the actions.
3. **Actions** (`.panel-actions`): **Open in {source}** (`a.button.panel-open`, a new tab) and **Add to workstream** (a `.button`; the app adds `panel-add`, which has no CSS). After adding, the button gives way to a line that says so, with Undo.
4. **Read line** (`p.panel-read`, `role="status"`): "Read 2 min ago", and, if the item changed in its source since, "Jira has changed since." with **Read again**.
5. **Body** (`.panel-body`): the source's blocks, in its order. Facts (`dl.panel-facts`), text or rich text under a heading (`.panel-heading` over `.reply.panel-prose` or `.panel-plain`), messages (`ol.panel-thread`), and notes (`.panel-note`).

```html specimen id=beside screen height=760 title="Beside the page, on a 1280 screen: the page narrows by the panel's width"
<div class="shell" data-panel data-folded>
  <aside id="sidebar" class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand"
        ><svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" /></svg
        ><span class="sidebar-label">Oriel</span></a
      >
      <button type="button" class="sidebar-fold" aria-controls="sidebar" aria-expanded="false">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M6 2.5v11" />
        </svg>
        <span class="visually-hidden">Show sidebar</span>
      </button>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link"
        ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5 9.5h6M5 11.5h4" /></svg
        ><span class="sidebar-label">Window</span></a
      >
    </nav>
  </aside>
  <div class="shell-main">
    <main class="page">
      <header class="workstream-head">
        <div class="workstream-title-row">
          <input
            class="workstream-title"
            value="Checkout v2: phone wallets and saved cards"
            aria-label="Workstream name"
            maxlength="120"
          />
        </div>
        <p class="workstream-origin">Copied from a cluster in the epic grouping · 5 items · v3</p>
      </header>
      <section class="section">
        <div class="section-head">
          <h2 class="section-title">Items</h2>
          <button type="button" class="quiet-action">Add from the window</button>
        </div>
        <ul class="members">
          <li class="member">
            <span class="type" data-type="epic" title="Epic"></span
            ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-1">SYN-1</a
            ><span class="member-title">Checkout v2: phone wallets and saved cards</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-10">SYN-10</a
            ><span class="member-title">Remove the legacy web-view checkout</span
            ><span class="status" data-category="todo">To Do</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-21">SYN-21</a
            ><span class="member-title">Update the payment declined error message</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-23">SYN-23</a
            ><span class="member-title">Pay with a phone wallet on the website</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="bug" title="Bug"></span
            ><a class="key source-link" href="https://example.atlassian.net/browse/SYN-74">SYN-74</a
            ><span class="member-title">Card form loses focus after autofill</span
            ><span class="status" data-category="done">Done</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
  <aside class="item-panel" aria-labelledby="item-panel-title-beside" data-steps>
    <nav class="panel-steps" aria-label="This list's items">
      <button type="button" class="panel-step" aria-label="Previous item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 9.75L8 6.25l3.5 3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Previous (↑)</span>
      <span class="panel-place">4 of 5</span>
      <button type="button" class="panel-step" aria-label="Next item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.25L8 9.75l3.5-3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Next (↓)</span>
    </nav>
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-23</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-beside" class="panel-title" tabindex="-1">
        Pay with a phone wallet on the website
      </h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://example.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Jira</a
        >
        <p class="panel-added" role="status">
          <span>In “Checkout v2: phone wallets and saved cards”.</span>
        </p>
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-04T09:41:00Z" title="Nov 4, 2026, 09:41">just now</time>
    </p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Type</dt>
          <dd>Story</dd>
        </div>
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>In Progress</dd>
        </div>
        <div class="panel-fact">
          <dt>Assignee</dt>
          <dd>Amara Okafor</dd>
        </div>
        <div class="panel-fact">
          <dt>Estimate</dt>
          <dd>Not estimated yet</dd>
        </div>
        <div class="panel-fact">
          <dt>Labels</dt>
          <dd>payments, web</dd>
        </div>
      </dl>
      <section>
        <h3 class="panel-heading">Description</h3>
        <div class="reply panel-prose">
          <p>
            Same as the app, for browsers that support it.
            <strong>Hide the button</strong> otherwise.
          </p>
        </div>
      </section>
    </div>
  </aside>
</div>
```

The parts on their own, at the panel's own width. Each sits in a folded `.shell`, as in the app: the shell sets `--panel` (30rem), and without it the panel has no width of its own. A frame narrower than 1100px lays it over the page with a shadow, as the app does.

```html specimen id=anatomy height=900 pad=0 title="Opened from a list, with every part of the head and a rich description"
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-a" data-steps>
    <nav class="panel-steps" aria-label="This list's items">
      <button type="button" class="panel-step" aria-label="Previous item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 9.75L8 6.25l3.5 3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Previous (↑)</span>
      <span class="panel-place">3 of 14</span>
      <button type="button" class="panel-step" aria-label="Next item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.25L8 9.75l3.5-3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Next (↓)</span>
    </nav>
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-23</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-a" class="panel-title" tabindex="-1">
        Pay with a phone wallet on the website
      </h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://example.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Jira</a
        >
        <button type="button" class="button">Add to workstream</button>
        <span role="tooltip" popover="manual" class="tooltip">Add to “Declined card retry”</span>
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-04T09:41:00Z" title="Nov 4, 2026, 09:41">just now</time>
    </p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Type</dt>
          <dd>Story</dd>
        </div>
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>In Progress</dd>
        </div>
        <div class="panel-fact">
          <dt>Assignee</dt>
          <dd>Amara Okafor</dd>
        </div>
        <div class="panel-fact">
          <dt>Estimate</dt>
          <dd>Not estimated yet</dd>
        </div>
        <div class="panel-fact">
          <dt>Labels</dt>
          <dd>payments, web</dd>
        </div>
      </dl>
      <section>
        <h3 class="panel-heading">Description</h3>
        <div class="reply panel-prose">
          <p>
            Same as the app, for browsers that support it.
            <strong>Hide the button</strong> otherwise.
          </p>
          <h3>Acceptance</h3>
          <ul>
            <li>Shows only where <code>canMakePayment()</code></li>
            <li>Falls back to the card form, <em>never</em> an error</li>
            <li>
              Matches the
              <a href="https://example.com/flow" target="_blank" rel="noopener noreferrer"
                >app's flow</a
              >
            </li>
          </ul>
          <pre><code>if (await wallet.canMakePayment()) show(button);
else hide(button);</code></pre>
          <p>
            <span class="mention" data-kind="mention">@Esme Whitlock</span> to check this before the
            review.
          </p>
        </div>
      </section>
      <section class="panel-messages">
        <h3 class="panel-heading">Comments</h3>
        <ol class="panel-thread">
          <li class="panel-message">
            <p class="panel-day">
              <span><time datetime="2026-11-04T09:12:00Z">Wednesday, November 4</time></span>
            </p>
            <span class="avatar" aria-hidden="true">AO</span>
            <p class="panel-said">
              <span class="panel-author">Amara Okafor</span
              ><time datetime="2026-11-04T09:12:00Z" title="Nov 4, 2026, 09:12">09:12</time>
            </p>
            <div class="panel-plain"><p>Design signed this off on Monday.</p></div>
          </li>
        </ol>
      </section>
    </div>
  </aside>
</div>
```

```html specimen id=messages height=760 pad=0 title="A conversation: day headers, a run, a label, mentions, files and an edit"
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-m">
    <header class="panel-head">
      <p class="panel-source">Slack · Message</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-m" class="panel-title" tabindex="-1">#weather-disruptions</h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://example.slack.com/archives/C01/p1"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Slack</a
        >
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-04T09:41:00Z" title="Nov 4, 2026, 09:41">just now</time>
    </p>
    <div class="panel-body">
      <section class="panel-messages">
        <ol class="panel-thread">
          <li class="panel-message">
            <p class="panel-day">
              <span><time datetime="2026-09-03T10:02:00Z">Thursday, September 3</time></span>
            </p>
            <span class="avatar" aria-hidden="true">DN</span>
            <p class="panel-said">
              <span class="panel-author">Dara Nikolaidis</span
              ><time datetime="2026-09-03T10:02:00Z" title="Sep 3, 2026, 10:02">10:02</time>
            </p>
            <div class="panel-plain">
              <p>
                Decision: when a sailing is cancelled for weather, passengers keep the fare they
                paid on any later sailing that day.<br />Next-day sailings are case by case for now.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section class="panel-messages">
        <h3 class="panel-heading">4 replies</h3>
        <ol class="panel-thread">
          <li class="panel-message">
            <span class="avatar" aria-hidden="true">BH</span>
            <p class="panel-said">
              <span class="panel-author">Bastian Holm</span
              ><time datetime="2026-09-03T10:20:00Z" title="Sep 3, 2026, 10:20">10:20</time>
            </p>
            <div class="panel-plain">
              <p>
                Does that include vehicle supplements? Can
                <span class="mention" data-kind="mention">@Dara Nikolaidis</span> check?
              </p>
            </div>
          </li>
          <li class="panel-message">
            <span class="avatar" aria-hidden="true">DN</span>
            <p class="panel-said">
              <span class="panel-author">Dara Nikolaidis</span
              ><time datetime="2026-09-03T10:31:00Z" title="Sep 3, 2026, 10:31">10:31</time
              ><span class="panel-label">Also sent to #weather-disruptions</span>
            </p>
            <div class="panel-plain"><p>Yes, supplements carry over too.</p></div>
          </li>
          <li class="panel-message" data-run>
            <div class="panel-plain">
              <p>Same fare, same supplements.</p>
            </div>
            <p class="panel-edited">
              <time datetime="2026-09-03T10:40:00Z" title="Edited Sep 3, 2026, 10:40"
                >(edited)</time
              >
            </p>
          </li>
          <li class="panel-message">
            <p class="panel-day">
              <span
                ><time datetime="2026-09-20T08:15:00Z">Sunday, September 20</time> · 17 days
                later</span
              >
            </p>
            <span class="avatar" aria-hidden="true">FH</span>
            <p class="panel-said">
              <span class="panel-author">Farid Haddad</span
              ><time datetime="2026-09-20T08:15:00Z" title="Sep 20, 2026, 08:15">08:15</time>
            </p>
            <div class="panel-plain">
              <p>
                Ops agreed next-day sailings follow the same rule. I've updated SYN-45 in
                <span class="mention" data-kind="channel">#fares</span>.
              </p>
            </div>
            <ul class="panel-files" aria-label="Files">
              <li class="panel-file">
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.25 2.25h5l2.5 2.5v9h-7.5zM9.25 2.25v2.5h2.5" /></svg
                >fare-rules.pdf
              </li>
            </ul>
          </li>
        </ol>
      </section>
    </div>
  </aside>
</div>
```

```html specimen id=linear height=620 pad=0 title="A Linear sub-issue: the issue's facts, then Linear's own, its team, project, cycle and parent"
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-l">
    <header class="panel-head">
      <p class="panel-source">Linear · ENG-5</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-l" class="panel-title" tabindex="-1">
        Alert copy for a moved sailing
      </h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://linear.app/ferrowick/issue/ENG-5"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Linear</a
        >
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-05T16:41:00Z" title="Nov 5, 2026, 16:41">just now</time>
    </p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Type</dt>
          <dd>Sub-issue</dd>
        </div>
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>Todo</dd>
        </div>
        <div class="panel-fact">
          <dt>Assignee</dt>
          <dd>Ines Carvalho</dd>
        </div>
        <div class="panel-fact">
          <dt>Estimate</dt>
          <dd>1 point</dd>
        </div>
        <div class="panel-fact">
          <dt>Labels</dt>
          <dd>notifications</dd>
        </div>
        <div class="panel-fact">
          <dt>Team</dt>
          <dd>ENG</dd>
        </div>
        <div class="panel-fact">
          <dt>Project</dt>
          <dd>Summer timetable launch</dd>
        </div>
        <div class="panel-fact">
          <dt>Cycle</dt>
          <dd>Cycle 13, Timetable freeze</dd>
        </div>
        <div class="panel-fact">
          <dt>Parent</dt>
          <dd>ENG-4</dd>
        </div>
      </dl>
      <section>
        <h3 class="panel-heading">Description</h3>
        <div class="reply panel-prose">
          <p>Short, with the old and new times. Reviewed by support.</p>
        </div>
      </section>
    </div>
  </aside>
</div>
```

```html specimen id=narrow width=390 height=640 pad=0 title="On a phone (≤760px): the whole screen, no left edge"
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-n" data-steps>
    <nav class="panel-steps" aria-label="This list's items">
      <button type="button" class="panel-step" aria-label="Previous item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 9.75L8 6.25l3.5 3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Previous (↑)</span>
      <span class="panel-place">11 of 13</span>
      <button type="button" class="panel-step" aria-label="Next item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.25L8 9.75l3.5-3.5" />
        </svg>
      </button>
      <span role="tooltip" popover="manual" class="tooltip">Next (↓)</span>
    </nav>
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-99</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-n" class="panel-title" tabindex="-1">Save a card for next time</h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://example.atlassian.net/browse/SYN-99"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Jira</a
        >
        <p class="panel-added" role="status">
          <span>Added to “Declined card retry”.</span
          ><button
            type="button"
            class="undo-action"
            aria-label="Undo: Added to “Declined card retry”."
          >
            Undo
          </button>
        </p>
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-04T09:41:00Z" title="Nov 4, 2026, 09:41">just now</time>
    </p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Type</dt>
          <dd>Story</dd>
        </div>
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>To Do</dd>
        </div>
        <div class="panel-fact">
          <dt>Assignee</dt>
          <dd>Dara Nikolaidis</dd>
        </div>
      </dl>
      <section>
        <h3 class="panel-heading">Description</h3>
        <div class="panel-plain">
          <p>
            Opt-in checkbox on the payment step. We store only the processor's token, never the card
            number.
          </p>
        </div>
      </section>
    </div>
  </aside>
</div>
```

**Where it sits.** The panel is `position: fixed` at the window's right edge, the whole window's height, `--panel` wide (30rem), in the [frame](/components/frame)'s material (`--frame`), as the sidebar is on the left: the page column, curved at both top corners, sits inset between the two (2026-11-08). Three widths, by the screen (`@media (min-width: 1100px)` and `@media (max-width: 760px)` in `window.css`):

- **1100px and wider: beside.** `.shell[data-panel]` sets `--beside` to the panel's width and `.shell-main` takes it as a right margin, so the page narrows and nothing is covered. No shadow. A narrowed page can cross its own container queries: a thread's [right rail](/components/right-rail) moves under the chat.
- **761 to 1099px: over the page's right side,** with `--shadow`, as the drawer casts. Over the window chat or a thread's page, with the conversation's dock at its foot.
- **760px and narrower: the whole screen,** from edge to edge and over the bar, on `--bg`, square, with no shade: a sheet. Its sides are `--space-3`, as a phone-width page's are.

**Motion.** It arrives at once, with a quick slide and fade, and only moves: "nothing beside or inside it reflows" (`.shell` in `window.css`). The panel's `@starting-style` in `window.css` starts it from `opacity: 0` and `translateX(var(--slide-panel))` (0.375rem), and it moves in over `--duration-quick` (120ms) on `--ease-out`. Its children fade in with `panel-fade` (`.item-panel > *` in `window.css`), again for each item it shows, while the panel itself stays put. Under reduced motion it keeps only the fade (`@media (prefers-reduced-motion: reduce)` in `window.css`). It has no closing animation: it leaves at once. See [Motion](/foundations/motion). The dock rises `--space-1` and fades in with it (`arrive`), and the folded line arrives the same way; under reduced motion both only fade.

### The dock, over a conversation (below 1100px)

Below 1100px the panel covers whatever conversation is open: the overview's window chat, or a thread's page. So it carries that conversation's composer in a dock at its foot (`.panel-dock`, decision 0025 amended by OA-335), and the person can read the item, ask about it and read the answer without closing it.

- **The latest answer's first two lines** (`.panel-dock-latest`), the rest cut. Sent and not yet answered, it shows the person's message (`.panel-dock-you`, "You: …") and "Working…", then the answer as it arrives. Chips in it open their items here.
- **Chat** (`.panel-dock-chat`) gives the conversation the screen. The item folds to a line above its composer (`.panel-folded`), with **Show**, which puts the item back, and ×, which closes it. Opening another item, or this one again from a chip, unfolds it.
- **The composer**, the conversation's own [chat input](/components/chat-input), with what the next message is about: "Looking at SYN-99". Sending keeps the item open.

The dock sticks to the panel's foot, edge to edge, in the frame's material, with a line over it, so the item scrolls under it. The conversation's own composer, under the panel, is out of use while the dock carries it: `inert` and hidden (`.chat-dock[inert]`). At 1100px and up there's no dock: the conversation stands beside the item.

```html specimen id=dock width=390 height=640 pad=0 title="On a phone, over the window chat: the dock with the latest answer and the composer"
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-d">
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-99</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-d" class="panel-title" tabindex="-1">Save a card for next time</h2>
    </header>
    <p class="panel-read" role="status">Read just now</p>
    <section class="panel-dock" aria-label="The conversation">
      <div class="panel-dock-head">
        <div class="panel-dock-latest">
          <p>
            Two stories carry saved cards. SYN-99 has no estimate yet. SYN-104 is halfway, and Greta
            calls the return URL the tricky part.
          </p>
        </div>
        <button type="button" class="quiet-action panel-dock-chat">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 9.75L8 6.25l3.5 3.5" />
          </svg>
          Chat
        </button>
      </div>
      <form class="chat-input" data-lines="grow">
        <div class="ctx" role="group" aria-label="What your message is about">
          <span class="ctx-chip"
            ><span class="ctx-label">Looking at</span
            ><span class="ctx-name"><b>SYN-99</b> Save a card for next time</span
            ><button type="button" class="ctx-x" aria-label="Leave SYN-99 out">×</button></span
          >
        </div>
        <textarea
          class="chat-input-field"
          rows="2"
          placeholder="Ask a follow-up"
          aria-label="Message"
        ></textarea>
        <div class="chat-input-foot">
          <span class="chat-input-reads">Reads your whole window, and SYN-99</span>
          <button type="submit" class="button" disabled>Send</button>
        </div>
      </form>
    </section>
  </aside>
</div>
```

```html specimen id=folded title="Folded: the item as a line above the conversation's composer"
<div class="panel-folded" role="group" aria-label="The item open">
  <span class="panel-folded-name"><b>SYN-99</b> Save a card for next time</span>
  <button type="button" class="quiet-action" aria-label="Show SYN-99">Show</button>
  <button type="button" class="panel-folded-close" aria-label="Close SYN-99">×</button>
  <span role="tooltip" popover="manual" class="tooltip">Close</span>
</div>
```

## States

```html specimen id=state-loading height=220 pad=0 title="Loading: before the first read" state=loading
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-l" aria-busy="true">
    <header class="panel-head">
      <p class="panel-source">Item</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-l" class="panel-title" tabindex="-1">Reading…</h2>
    </header>
  </aside>
</div>
```

```html specimen id=state-failed height=260 pad=0 title="Error: the source didn't answer" state=error
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-f">
    <header class="panel-head">
      <p class="panel-source">Item</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-f" class="panel-title" tabindex="-1">Couldn't read this item</h2>
    </header>
    <p class="panel-problem" role="alert">
      Jira didn't answer, so Oriel couldn't read this item. Try again.
      <button type="button" class="quiet-action">Try again</button>
    </p>
  </aside>
</div>
```

```html specimen id=state-behind height=300 pad=0 title="Stale: the source changed after the read" state=stale
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-b">
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-23</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-b" class="panel-title" tabindex="-1">
        Pay with a phone wallet on the website
      </h2>
      <div class="panel-actions">
        <a
          class="button panel-open"
          href="https://example.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          >Open in Jira</a
        >
      </div>
    </header>
    <p class="panel-read" role="status">
      Read <time datetime="2026-11-04T09:30:00Z" title="Nov 4, 2026, 09:30">12 min ago</time> ·
      <strong class="panel-behind">Jira has changed since.</strong>
      <button type="button" class="quiet-action">Read again</button>
    </p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>In Progress</dd>
        </div>
      </dl>
    </div>
  </aside>
</div>
```

```html specimen id=state-reading-again height=260 pad=0 title="Busy: reading again, the old read still shown" state=busy
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-r" aria-busy="true">
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-23</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-r" class="panel-title" tabindex="-1">
        Pay with a phone wallet on the website
      </h2>
    </header>
    <p class="panel-read" role="status">Reading again…</p>
    <div class="panel-body">
      <dl class="panel-facts">
        <div class="panel-fact">
          <dt>Status</dt>
          <dd>In Progress</dd>
        </div>
      </dl>
    </div>
  </aside>
</div>
```

```html specimen id=state-notes height=420 pad=0 title="Notes instead of a body: moved, gone, can't read, and empty comments" state=empty
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-g">
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-12</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-g" class="panel-title" tabindex="-1">
        Make the language switcher announce the current language
      </h2>
    </header>
    <p class="panel-note">
      This item moved to
      <a class="key source-link" href="https://example.atlassian.net/browse/SYN-62">SYN-62</a> Label
      the passenger count steppers.
    </p>
    <p class="panel-note">This item isn't in Jira any more.</p>
    <p class="panel-note">Oriel can't read this item in Jira now.</p>
    <p class="panel-note">Jira sent this item in a shape Oriel can't show.</p>
    <section class="panel-messages">
      <h3 class="panel-heading">Comments</h3>
      <p class="panel-empty">No comments.</p>
    </section>
  </aside>
</div>
```

```html specimen id=state-added height=300 pad=0 title="Added, already in, and a failed add" state=done
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-d">
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-99</p>
      <button type="button" class="panel-close" aria-label="Close the panel">×</button>
      <span role="tooltip" popover="manual" class="tooltip">Close (Esc)</span>
      <h2 id="item-panel-title-d" class="panel-title" tabindex="-1">Save a card for next time</h2>
      <div class="panel-actions">
        <p class="panel-added" role="status">
          <span>Added to “Declined card retry”.</span
          ><button
            type="button"
            class="undo-action"
            aria-label="Undo: Added to “Declined card retry”."
          >
            Undo
          </button>
        </p>
      </div>
      <div class="panel-actions">
        <p class="panel-added" role="status"><span>Already in “Declined card retry”.</span></p>
      </div>
      <div class="panel-actions">
        <button type="button" class="button">Add to workstream</button>
        <p class="panel-problem" role="alert">Something went wrong. Try again.</p>
      </div>
    </header>
  </aside>
</div>
```

```html specimen id=state-steps height=120 pad=0 title="Steps: first item (Previous disabled), hover and focus" state=hover
<div class="shell" data-folded>
  <aside class="item-panel" aria-labelledby="item-panel-title-s" data-steps>
    <nav class="panel-steps" aria-label="This list's items">
      <button type="button" class="panel-step" aria-label="Previous item" disabled>
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 9.75L8 6.25l3.5 3.5" />
        </svg>
      </button>
      <span class="panel-place">1 of 17</span>
      <button type="button" class="panel-step ws-hover" aria-label="Next item">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.25L8 9.75l3.5-3.5" />
        </svg>
      </button>
    </nav>
    <header class="panel-head">
      <p class="panel-source">Jira · SYN-1</p>
      <button type="button" class="panel-close ws-focus-visible" aria-label="Close the panel">
        ×
      </button>
      <h2 id="item-panel-title-s" class="panel-title" tabindex="-1">
        Checkout v2: phone wallets and saved cards
      </h2>
    </header>
  </aside>
</div>
```

- **Rest** is the read item. **Hover** on Previous, Next and Close is `--surface-hover` behind `--text` (`.panel-close:hover` and `.panel-step:hover:not(:disabled)` in `window.css`). **Focus-visible** is the global ring on every control. The title takes focus on open but draws no ring (`.panel-title:focus` in `window.css` sets `outline: none`), since the person didn't put it there.
- **Disabled**: Previous on the first item and Next on the last, at 0.35 (`.panel-step:disabled` in `window.css`), lighter than a disabled `.button`'s 0.5. Add to workstream is disabled while its add is pending.
- **Active** isn't styled.
- **Loading**: opened from a page that shows the item (Browse's rows, a workstream's or a thread's members), the head says its key and title at once, and the read line its status and "Reading…" (`glimpseOf` in `packages/web/src/root.ts`); the rest arrives with the read. Opened from an address alone, the head says "Item" and "Reading…". Both set `aria-busy="true"`. **Reading again** keeps the old read and says "Reading again…" in the read line.
- **Error**: the head says "Couldn't read this item", and a `.panel-problem` in `--danger` gives the server's sentence and Try again. A failed add is a `.panel-problem` in the actions.
- **Stale** ("behind"): the index saw a change later than both the read and what it knew at the read (`behind` in `packages/web/src/panel.ts`). The read line adds the source's name and "has changed since." in `--derived`, with Read again. The panel doesn't re-read on its own.
- **Empty**: a messages block with none says the source's own words (`.panel-empty`): "No comments." in Jira, "No replies yet." in Slack. A moved, deleted or unreadable item is a `.panel-note` in place of the body.

## Keyboard and ARIA

- `aside.item-panel` is labelled by its title (`aria-labelledby="item-panel-title"`) and sets `aria-busy` while it reads.
- Opening moves focus to the title (`h2`, `tabindex="-1"`), unless focus is on Previous or Next, which keep it (`ItemPanel` in `packages/web/src/item-panel.tsx`). The steps sit outside the per-item content, so they aren't redrawn and don't lose focus.
- Closing gives focus back to what had it when the panel opened (`ItemPanel` in `packages/web/src/item-panel.tsx`).
- **Escape** closes it, after the drawer: "The drawer closes first, over the panel; then the panel" (`App` in `packages/web/src/app.tsx`).
- **↑ and ↓** step through the list from anywhere except a field, a menu, a dialog, a listbox or a combobox; with Alt, Ctrl, Cmd or Shift they do nothing (`ItemPanel` in `packages/web/src/item-panel.tsx`).
- Previous and Next are `button`s labelled "Previous item" and "Next item" in a `nav` labelled "This list's items". Close is labelled "Close the panel". Their [tooltips](/components/tooltip) add the key: "Previous (↑)", "Next (↓)", "Close (Esc)". Add to workstream's tooltip names the workstream: Add to “Declined card retry”.
- The read line and the added line are `role="status"`; a read that failed is `role="alert"`.
- It isn't a dialog: no focus trap and no `aria-modal`. Tab goes on from its last control to the page's next.

## Content

- The source line is "{source} · {key}", such as "Jira · SYN-23" or "Slack · Message"; before the first read, the key alone, or "Item" when the page didn't show it.
- The title is the source's title, as written. While reading: the title the index has, else "Reading…". On failure: "Couldn't read this item".
- Actions: **Open in {source}** ("Open in Jira") and **Add to workstream**. After adding: Added to “{name}”. with Undo, or Already in “{name}”., or In “{name}”. when the page already holds it. Names in curly quotes.
- Read line: "Read {when}" in the person's time format; behind: "{source} has changed since." and **Read again**; re-reading: "Reading again…".
- Notes: "This item moved to {key} {title}.", "This item isn't in {source} any more.", "Oriel can't read this item in {source} now.", "{source} sent this item in a shape Oriel can't show."
- A conversation's day header is the weekday, month and day ("Wednesday, November 4"), plus " · 17 days later" when it's a day or more after the message before. Times under it are the clock alone. "(edited)" after an edited message, with "Edited {when}" on hover.
- Fact names and values, headings, labels and empty lines are the source's words, not Oriel's.
- A tracker's issue shows the issues shape's facts first, Type, Status, Assignee, Estimate and Labels, each only where its tracker has it, then its own (decision 0059): Linear's Team, Project, Cycle and Parent, or a project's Lead and Target date (OA-278). Linear keeps its descriptions as markdown, so they read as a reply does.

## Where the app uses it

- `ItemPanel` in `packages/web/src/item-panel.tsx` draws the steps, the head, and the failure and read lines; the shell renders it once, from `App` in `packages/web/src/app.tsx`.
- The dock: `PanelDock` in `packages/web/src/item-panel.tsx`, in `ItemPanel`'s `dock` slot, reads `PanelDockContext` in `packages/web/src/dock.tsx`, which `App` fills from the conversation under the item (`dockOf` in `packages/web/src/app.tsx`), through the same composer the conversation draws (`windowChatComposer` in `packages/web/src/window-chat-view.tsx`, `threadComposer` in `packages/web/src/thread-page.tsx`). The latest answer is drawn as the thread draws it, by `AnswerText` in `packages/web/src/thread-page.tsx`, and picked by `latestOf` in `packages/web/src/dock.tsx`. The folded line: `FoldedItem` in `packages/web/src/dock.tsx`. CSS `.panel-dock`, `.panel-dock-head`, `.panel-dock-latest`, `.panel-dock-you`, `.panel-dock-chat`, `.panel-folded`, `.panel-folded-name`, `.panel-folded-close` and `.chat-dock[inert]` in `window.css`. Add to, notes, blocks and messages: `AddTo`, `PanelBody`, `Block` and `Messages` in `packages/web/src/item-panel.tsx`.
- The body's text as the source wrote it: rich text and its blocks by `ProseBlocks` in `packages/web/src/parts.tsx`, and a paragraph's runs, mentions and links by `Inlines` in `packages/web/src/parts.tsx`. They render what a source has already read, as text, never as markup; their look is the body's and `.mention`'s.
- Opened by `ItemLink` in `packages/web/src/parts.tsx`; which workstream it adds to: `currentWorkstream` in `packages/web/src/root.ts`; when it's behind: `behind` in `packages/web/src/panel.ts`.
- CSS: the panel and its widths `.shell`, `.item-panel`, `.item-panel > *`, `.shell-main` and `.shell[data-panel]` in `window.css`; the head `.panel-head` in `window.css`; the steps `.panel-steps` in `window.css`; the status lines `.panel-read` in `window.css`; the body `.panel-body` in `window.css`; `.mention` in `window.css`; messages `.panel-message` in `window.css`; `.item-link` in `window.css`.
- The window chat's panel shares its width and look (`.window-chat` in `window.css`) but not its behaviour; see [Message](/components/message).

Some classes the app renders have no CSS, so specimens leave them off: `panel-add` on Add to workstream (`AddTo` in `packages/web/src/item-panel.tsx`), `panel-text` on the section around a text block (`Block` in `packages/web/src/item-panel.tsx`); and `data-kind` on `.mention` has no rule.
