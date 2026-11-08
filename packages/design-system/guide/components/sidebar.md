---
title: Sidebar
status: drifting
group: Layout
order: 60
classes: shell, shell-main, frame, sidebar, sidebar-head, brand, mark, sidebar-label, sidebar-fold, bar, bar-menu, bar-count, drawer-backdrop, sidebar-search, sidebar-search-row, sidebar-search-open, sidebar-search-field, sidebar-new, search-results, search-list, search-result, search-result-head, search-result-set, search-result-excerpt, sidebar-pages, nav-link, nav-name, nav-count, sidebar-needs, nav-waiting, nav-waiting-link, nav-waiting-text, nav-waiting-about, nav-waiting-on, nav-waiting-workstream, nav-more, state-dot, sidebar-workstreams, fold-head, fold-toggle, chevron, rail-title, rail-empty, nav-workstreams, nav-workstream-row, nav-workstream-menu, nav-disclose, nav-threads, nav-thread, working-dot, sidebar-done, nav-done, sidebar-sources, sources-line, warning-mark, nav-sources, source-row, source-synced, source-sync, source-changes, source-problem, add-source, sidebar-foot, icon, visually-hidden, tooltip
summary: The column beside every page but a review link: the window, what needs you, the workstreams with their threads, Done, the sources and Settings. Folds to icons on a wide screen; a drawer under a bar on a narrow one.
---

# Sidebar

## What it is

The sidebar is the app's one navigation, on every page but a review link and the first run. In Oriel's words: "the window, the threads waiting on the user, the user's workstreams with their threads under them, the latest done threads, the sources, and Settings at the foot. It stays quiet unless something is happening: what waits on the user is at the top, the rest fold" (`packages/web/src/sidebar.tsx`).

It lives in the **shell**, the two-column grid every page sits in: `div.shell` holds `aside.sidebar` and `div.shell-main`, and the page goes in `.shell-main` (`App` in `packages/web/src/app.tsx`). The sidebar is the [frame](/components/frame)'s material: the shell paints `--frame` the whole height of the page, so a long page never shows a gap under it, and there's no line between the sidebar and the page column, whose top corner curves into it (`.shell` and `.frame` in `window.css`).

From top to bottom:

1. **Head**: the brand, which goes to the overview, and the fold button.
2. **Search** over threads, with **New thread** beside it as an icon.
3. **Pages**: Window (the overview and Browse).
4. **Needs you**: each thread waiting on the person, with no heading. Nothing shows when nothing waits.
5. **Workstreams**, under a heading that folds them, each with its threads.
6. **Done**, folded until opened.
7. **Sources**, folded to one quiet line.
8. **Settings**, at the very foot.

Workstreams, Done, Sources and Settings sit together at the foot, "so Needs you has the room under the pages" (`.sidebar-workstreams` in `window.css`).

## When to use it

- Draw it once, in the shell, on every page that has one. A screen that shows a page in Oriel shows the sidebar beside it, with the right row marked current.
- Use its rows (`.nav-link`) for going somewhere in the app: a page, a workstream, a thread. Each is a real link (`<a href>`), or a `<button>` only when it changes the sidebar itself ("3 more" in Needs you, a disclosure, a fold).
- Use a `.state-dot` wherever a thread is named in a dense list and its state matters at a glance.

## When not to

- Not on a review link's page or in the first run (`App` in `packages/web/src/app.tsx`). Those stand alone.
- Not for actions on a thread or workstream. Mark done and Delete are in each row's context menu and swipe, not drawn in the row. See [Menu](/components/menu).
- Not a second list of items. Items live on the page, in [list rows](/components/list-row); the sidebar names workstreams and threads only, with an item count.
- Don't add a heading over Needs you. Each row says what it waits on, which says why it's there (`NeedsYou` in `packages/web/src/sidebar.tsx`).

## Anatomy and variants

### The whole sidebar

The sidebar is sticky and as tall as the window (`height: 100vh` on `.sidebar`), and scrolls on its own. Its width is the shell's `--sidebar`, 15.5rem, or 3.25rem folded (`.shell` and `.shell[data-folded]` in `window.css`).

```html specimen id=whole title="The sidebar beside the overview" height=800 pad=0
<div class="shell">
  <aside id="sidebar" class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        <span class="sidebar-label">Oriel</span>
      </a>
      <button
        type="button"
        class="sidebar-fold"
        aria-controls="sidebar"
        aria-expanded="true"
        aria-describedby="tip-fold"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M6 2.5v11" />
        </svg>
        <span class="visually-hidden">Hide sidebar</span>
      </button>
      <span id="tip-fold" role="tooltip" popover="manual" class="tooltip"
        >Hide the sidebar (⌘\)</span
      >
    </div>
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <button type="button" class="sidebar-search-open nav-link">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="sidebar-label">Search threads</span>
        </button>
        <span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
          >Search threads</span
        >
        <label class="sidebar-search-field">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="visually-hidden">Search threads</span>
          <input
            id="thread-search"
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            placeholder="Search threads"
            aria-expanded="false"
            aria-controls="thread-search-results"
            aria-autocomplete="list"
          />
        </label>
        <a
          href="/threads/new"
          class="sidebar-new nav-link"
          aria-label="New thread"
          aria-describedby="tip-new"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </a>
        <span id="tip-new" role="tooltip" popover="manual" class="tooltip"
          >New thread: start from nothing, such as a plan for a new epic</span
        >
      </div>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link" aria-current="page">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5 9.5h6M5 11.5h4" />
        </svg>
        <span class="sidebar-label">Window</span>
      </a>
    </nav>
    <nav id="needs-you" class="sidebar-needs" aria-label="Needs you" tabindex="-1">
      <ul class="nav-waiting">
        <li>
          <a href="/threads/whats-in-here" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="reply"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">What's in here?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
                <span class="nav-waiting-workstream">Saved cards launch</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/estimates" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Which stories here still need estimates?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/plan-gift-cards" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="held"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Plan gift cards</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="held">Message held</span>
                <span class="nav-waiting-workstream">Gift cards</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/built-stories" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Mark the built stories done</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li><button type="button" class="nav-link nav-more">3 more</button></li>
      </ul>
    </nav>
    <nav class="sidebar-workstreams" aria-label="Workstreams">
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="true"
            aria-controls="nav-workstreams"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Workstreams
          </button>
        </h2>
      </div>
      <ul id="nav-workstreams" class="nav-workstreams">
        <li>
          <div class="nav-workstream-row">
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/gift-cards" class="nav-link">
                <span class="nav-name">Gift cards</span>
                <span class="nav-count" title="0 items">0</span>
              </a>
            </div>
          </div>
        </li>
        <li>
          <div class="nav-workstream-row">
            <button
              type="button"
              class="nav-disclose"
              aria-expanded="false"
              aria-controls="nav-threads-saved"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden">Show threads in Saved cards launch</span>
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/saved-cards" class="nav-link">
                <span class="nav-name">Saved cards launch</span>
                <span class="nav-count" title="6 items">6</span>
              </a>
            </div>
          </div>
        </li>
        <li>
          <div class="nav-workstream-row">
            <button
              type="button"
              class="nav-disclose"
              aria-expanded="true"
              aria-controls="nav-threads-checkout"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden"
                >Hide threads in Checkout v2: phone wallets and saved cards</span
              >
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/checkout-v2" class="nav-link">
                <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
                <span class="working-dot" title="1 agent working"></span>
                <span class="nav-count" title="17 items">17</span>
              </a>
            </div>
          </div>
          <ul id="nav-threads-checkout" class="nav-threads">
            <li>
              <a href="/threads/estimates" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="review"
                  title="Needs review"
                ></span>
                <span class="nav-name">Which stories here still need estimates?</span>
              </a>
            </li>
            <li>
              <a href="/threads/weather" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="agent"
                  title="Agent working"
                ></span>
                <span class="nav-name">Find anything about weather</span>
              </a>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
    <nav class="sidebar-done" aria-label="Done">
      <div class="fold-head">
        <h2 class="rail-title">
          <button type="button" class="fold-toggle" aria-expanded="false" aria-controls="nav-done">
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Done<span class="nav-count">8</span>
          </button>
        </h2>
      </div>
    </nav>
    <section class="sidebar-sources" aria-label="Sources">
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="false"
            aria-controls="nav-sources"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Sources
          </button>
        </h2>
        <span class="sources-line">2 sources · 5 min ago</span>
      </div>
    </section>
    <nav class="sidebar-foot" aria-label="Settings">
      <a href="/settings" class="nav-link">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h6.25M12.25 4.5h1.25M2.5 11.5h1.25M7.25 11.5h6.25" />
          <circle cx="10.5" cy="4.5" r="1.75" />
          <circle cx="5.5" cy="11.5" r="1.75" />
        </svg>
        <span class="sidebar-label">Settings</span>
      </a>
    </nav>
  </aside>
  <button type="button" class="drawer-backdrop" tabindex="-1" aria-hidden="true"></button>
  <div class="shell-main">
    <div class="page"><p class="ws-note">The page goes here.</p></div>
  </div>
</div>
```

The markup in these specimens leaves out two wrappers the app draws around every thread and workstream row: the context menu's `<div>` (with its `div.context-menu[popover]`) and the swipe's `div.swipe > div.swipe-actions + div.swipe-row` (`Swipeable` in `packages/web/src/swipe.tsx`). Neither changes how a row looks at rest. `.nav-workstream-menu` is that menu wrapper's class on a workstream row, and it stays, because it gives the link its width.

### The row: a nav link

Every row is a `.nav-link`: a flex row at least 1.875rem tall, muted text, a `--radius` corner (`.nav-link` in `window.css`). Its name is a `.nav-name`, cut with an ellipsis, and a number after it is a `.nav-count`, faint and tabular. The current page's row is raised: the surface, a hairline ring and `--shadow-sm`, at medium weight (`.nav-link[aria-current="page"]` in `window.css`).

Variants are modifier classes on the same link:

- `.nav-waiting-link`: a waiting thread, two lines (Needs you).
- `.nav-thread`: a thread under a workstream or in Done, 1.75rem tall.
- `.nav-more`: "3 more", faint and small, indented past the dot.
- `.sidebar-new`: New thread, a 1.875rem square.
- `.sidebar-search-open`: the search icon, shown only folded.

### Search and New thread

The field is `.sidebar-search-field`, a label around the icon, a hidden name and the input. The label draws the focus: a `--focus` border and ring on `:focus-within`, while the input itself has no outline (`.sidebar-search-field:focus-within` in `window.css`). Typing finds threads by name, by what was said in them and by what their change sets wrote. While the field has a query, its results take the place of Needs you, Workstreams and Done, below Window, so nothing above them moves as typing starts (`SearchResults` in `packages/web/src/sidebar.tsx`).

```html specimen id=search-results title="Search with results" height=380 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <label class="sidebar-search-field">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="visually-hidden">Search threads</span>
          <input
            id="thread-search-2"
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            placeholder="Search threads"
            value="estimate"
            aria-expanded="true"
            aria-controls="results-2"
            aria-autocomplete="list"
            aria-activedescendant="result-2-0"
          />
        </label>
        <a href="/threads/new" class="sidebar-new nav-link" aria-label="New thread">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </a>
      </div>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5 9.5h6M5 11.5h4" />
        </svg>
        <span class="sidebar-label">Window</span>
      </a>
    </nav>
    <div class="search-results">
      <p class="rail-empty" role="status">3 results</p>
      <div id="results-2" role="listbox" aria-label="Threads found" class="search-list">
        <a
          id="result-2-0"
          role="option"
          tabindex="-1"
          aria-selected="true"
          class="search-result"
          href="/threads/estimates"
        >
          <span class="search-result-head"
            ><span class="nav-name">Which stories here still need estimates?</span></span
          >
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </a>
        <a
          id="result-2-1"
          role="option"
          tabindex="-1"
          aria-selected="false"
          class="search-result"
          href="/threads/estimates"
        >
          <span class="search-result-head">
            <span class="nav-name">Which stories here still need estimates?</span>
            <span class="search-result-set" data-state="pending">Change set waiting</span>
          </span>
          <span class="search-result-excerpt"
            >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.</span
          >
          <span class="nav-waiting-workstream">Checkout v2: phone wallets and saved cards</span>
        </a>
        <a
          id="result-2-2"
          role="option"
          tabindex="-1"
          aria-selected="false"
          class="search-result"
          href="/threads/plan-gift-cards"
        >
          <span class="search-result-head"><span class="nav-name">Plan gift cards</span></span>
          <span class="search-result-excerpt"
            >Which of these have no estimate yet, and which epic should hold them?</span
          >
          <span class="nav-waiting-workstream">Gift cards</span>
        </a>
      </div>
    </div>
  </aside>
  <div class="shell-main"></div>
</div>
```

A result is a `.search-result`: its title, a `.search-result-set` when a change set matched (accent, or faint once rejected or reverted), a two-line `.search-result-excerpt` unless the name matched, and its workstream. The status line above them says "3 results", "No thread matches that." or "Oriel couldn't search just now. Keep typing to try again.", and is hidden while a search is still on its way.

### Needs you, and the state dot

Each waiting thread is a `.nav-waiting-link`: a `.state-dot`, the title, then a small line of what it waits on (`.nav-waiting-on`) and its workstream (`.nav-waiting-workstream`, after a "·" that readers skip). Eight show; "N more" is a button that shows the rest in place.

```html specimen id=needs-you title="Needs you, every reason a thread waits on you" height=330 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <nav class="sidebar-needs" aria-label="Needs you" tabindex="-1">
      <ul class="nav-waiting">
        <li>
          <a href="/threads/estimates" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Which stories here still need estimates?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/plan-gift-cards" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="held"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Plan gift cards</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="held">Message held</span>
                <span class="nav-waiting-workstream">Gift cards</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/built-stories" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="stalled"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Mark the built stories done</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="stalled">Apply stalled</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/rename-epic" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="draft"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Rename the epic and plan gift cards in it</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="draft">Draft to apply</span>
                <span class="nav-waiting-workstream">Gift cards</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/whats-in-here" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="reply"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">What's in here?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
                <span class="nav-waiting-workstream">Saved cards launch</span>
              </span>
            </span>
          </a>
        </li>
        <li><button type="button" class="nav-link nav-more">3 more</button></li>
      </ul>
    </nav>
  </aside>
  <div class="shell-main"></div>
</div>
```

The `.state-dot` is a 0.4375rem circle: "working pulses, the rest hold still" (`.state-dot` in `window.css`). Its colour comes from `data-state`, and from `data-waiting` while a thread waits:

```html specimen id=state-dots title="The state dot, every value (under a workstream)" height=360 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <ul class="nav-threads">
      <li>
        <a href="#a" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="agent"
            title="Agent working"
          ></span
          ><span class="nav-name">Agent working (pulses)</span></a
        >
      </li>
      <li>
        <a href="#b" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="apply"
            title="Applying…"
          ></span
          ><span class="nav-name">Applying… (pulses)</span></a
        >
      </li>
      <li>
        <a href="#c" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="review"
            title="Needs review"
          ></span
          ><span class="nav-name">Needs review</span></a
        >
      </li>
      <li>
        <a href="#d" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="held"
            title="Message held"
          ></span
          ><span class="nav-name">Message held</span></a
        >
      </li>
      <li>
        <a href="#e" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="stalled"
            title="Apply stalled"
          ></span
          ><span class="nav-name">Apply stalled</span></a
        >
      </li>
      <li>
        <a href="#f" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="draft"
            title="Draft to apply"
          ></span
          ><span class="nav-name">Draft to apply</span></a
        >
      </li>
      <li>
        <a href="#g" class="nav-link nav-thread"
          ><span
            class="state-dot"
            data-state="working"
            data-waiting="reply"
            title="Your turn"
          ></span
          ><span class="nav-name">Your turn</span></a
        >
      </li>
      <li>
        <a href="#h" class="nav-link nav-thread"
          ><span class="state-dot" data-state="working" title="Working"></span
          ><span class="nav-name">Working</span></a
        >
      </li>
      <li>
        <a href="#i" class="nav-link nav-thread"
          ><span class="state-dot" data-state="done" title="Done"></span
          ><span class="nav-name">Done</span></a
        >
      </li>
      <li>
        <a href="#j" class="nav-link nav-thread"
          ><span class="state-dot" data-state="handed-off" title="Handed off"></span
          ><span class="nav-name">Handed off</span></a
        >
      </li>
      <li>
        <a href="#k" class="nav-link nav-thread"
          ><span class="state-dot" data-state="dropped" title="Dropped"></span
          ><span class="nav-name">Dropped</span></a
        >
      </li>
    </ul>
  </aside>
  <div class="shell-main"></div>
</div>
```

- `agent` and `apply` pulse (1.6s), and hold still under reduced motion (`@media (prefers-reduced-motion: reduce)` in `window.css`).
- `review`, `held` and `stalled` are the accent: a change set to review, a held message or a stalled apply is the person's move.
- `draft` and `reply` also wait on the person, but draw as plain working. That's drift; see below.
- `done` is `--done`, `handed-off` is `--handed-off`, and `dropped` is a hollow ring.

### Workstreams and their threads

A workstream row is `.nav-workstream-row`: a `.nav-disclose` chevron button that shows or hides its threads, then its link with its name, a `.working-dot` while an agent works in one of its threads, and its item count. A workstream with no threads keeps an empty `span.nav-disclose` so the names line up. Its threads are a `.nav-threads` list, indented under a hairline; five show, then "N more", a link to the workstream's page.

```html specimen id=workstreams title="Workstreams: one current and open, one with an agent working" height=330 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <nav class="sidebar-workstreams" aria-label="Workstreams">
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="true"
            aria-controls="nav-workstreams-3"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Workstreams
          </button>
        </h2>
      </div>
      <ul id="nav-workstreams-3" class="nav-workstreams">
        <li>
          <div class="nav-workstream-row">
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/declined" class="nav-link">
                <span class="nav-name">Declined card retry</span>
                <span class="nav-count" title="1 item">1</span>
              </a>
            </div>
          </div>
        </li>
        <li data-current>
          <div class="nav-workstream-row">
            <button
              type="button"
              class="nav-disclose"
              aria-expanded="true"
              aria-controls="nav-threads-3"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden">Hide threads in Saved cards launch</span>
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/saved-cards" class="nav-link" aria-current="page">
                <span class="nav-name">Saved cards launch</span>
                <span class="nav-count" title="6 items">6</span>
              </a>
            </div>
          </div>
          <ul id="nav-threads-3" class="nav-threads">
            <li>
              <a href="/threads/whats-in-here" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="reply"
                  title="Your turn"
                ></span>
                <span class="nav-name">What's in here?</span>
              </a>
            </li>
          </ul>
        </li>
        <li>
          <div class="nav-workstream-row">
            <button
              type="button"
              class="nav-disclose"
              aria-expanded="true"
              aria-controls="nav-threads-4"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden"
                >Hide threads in Checkout v2: phone wallets and saved cards</span
              >
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/checkout-v2" class="nav-link">
                <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
                <span class="working-dot" title="1 agent working"></span>
                <span class="nav-count" title="17 items">17</span>
              </a>
            </div>
          </div>
          <ul id="nav-threads-4" class="nav-threads">
            <li>
              <a href="/threads/estimates" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="review"
                  title="Needs review"
                ></span>
                <span class="nav-name">Which stories here still need estimates?</span>
              </a>
            </li>
            <li>
              <a href="/threads/weather" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="agent"
                  title="Agent working"
                ></span>
                <span class="nav-name">Find anything about weather</span>
              </a>
            </li>
            <li><a href="/workstreams/checkout-v2" class="nav-link nav-more">4 more</a></li>
          </ul>
        </li>
      </ul>
    </nav>
  </aside>
  <div class="shell-main"></div>
</div>
```

With no workstreams yet, the list is a line: "Pick items in the window, or make a workstream from a cluster." as `p.rail-empty`.

### Fold heads: Workstreams, Done, Sources

A section that folds has a `.fold-head`: an `h2.rail-title` (uppercase, extra small, faint) holding a `.fold-toggle` button with a chevron that turns 90° when open, and, at its end, what it says folded or its actions. Workstreams start open; Done and Sources start folded. Each is remembered in this browser only.

```html specimen id=done title="Done, open, with more on the Done page" height=250 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <nav class="sidebar-done" aria-label="Done">
      <div class="fold-head">
        <h2 class="rail-title">
          <button type="button" class="fold-toggle" aria-expanded="true" aria-controls="nav-done-5">
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Done<span class="nav-count">8</span>
          </button>
        </h2>
      </div>
      <ul id="nav-done-5" class="nav-threads nav-done">
        <li>
          <a href="/threads/become" class="nav-link nav-thread" title="Window chat"
            ><span class="state-dot" data-state="done" title="Done"></span
            ><span class="nav-name">What should become a workstream?</span></a
          >
        </li>
        <li>
          <a href="/threads/quiet" class="nav-link nav-thread" title="Window chat"
            ><span class="state-dot" data-state="done" title="Done"></span
            ><span class="nav-name">Which workstreams are quiet?</span></a
          >
        </li>
        <li>
          <a href="/threads/handoff" class="nav-link nav-thread" title="Saved cards launch"
            ><span class="state-dot" data-state="handed-off" title="Handed off"></span
            ><span class="nav-name">Hand the saved-card stories to Amara</span></a
          >
        </li>
        <li><a href="/done" class="nav-link nav-more">5 more</a></li>
        <li><a href="/done?tab=dropped" class="nav-link nav-more">2 dropped</a></li>
      </ul>
    </nav>
  </aside>
  <div class="shell-main"></div>
</div>
```

Opened with nothing done, the list holds one `li.rail-empty`: "No thread is done yet."

### Sources

Folded, Sources is one `.sources-line` beside its heading: how many sources and when the longest ago of them last synced. It turns the accent while any syncs, and danger with a `.warning-mark` while any has a problem. A problem also opens the section.

```html specimen id=sources-folded title="Sources folded: at rest, syncing, a problem" height=200 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <section class="sidebar-sources" aria-label="Sources">
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="false"
            aria-controls="nav-sources-a"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Sources
          </button>
        </h2>
        <span class="sources-line">2 sources · 5 min ago</span>
      </div>
    </section>
    <section class="sidebar-sources" aria-label="Sources, syncing" data-syncing>
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="false"
            aria-controls="nav-sources-b"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Sources
          </button>
        </h2>
        <span class="sources-line">Syncing…</span>
      </div>
    </section>
    <section class="sidebar-sources" aria-label="Sources, with a problem" data-problem>
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="false"
            aria-controls="nav-sources-c"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Sources
          </button>
        </h2>
        <span class="sources-line">
          <svg
            class="icon warning-mark"
            viewBox="0 0 16 16"
            role="img"
            aria-label="A source has a problem"
          >
            <path d="M8 2.5l6 10.5H2zM8 6.5v3M8 11.25v.25" />
          </svg>
          2 sources · 5 min ago
        </span>
      </div>
    </section>
  </aside>
  <div class="shell-main"></div>
</div>
```

Open, each source is a `.source-row`: its link (name, item count, `.source-synced`) opens Browse filtered to it, and **Sync** sits at its end, shown on hover or focus where there is hover (`.source-row:not(:hover, :focus-within) .source-sync` in `window.css`). What its last sync changed goes under it (`.source-changes`), or its problem (`.source-problem`, `role="alert"`). **Sync all** heads them when there's more than one; **Add a source** is the last entry and opens Settings › Connections.

```html specimen id=sources-open title="Sources open: synced, syncing, and a problem" height=280 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <section class="sidebar-sources" aria-label="Sources" data-syncing data-problem>
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="true"
            aria-controls="nav-sources-6"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Sources
          </button>
        </h2>
        <button type="button" class="quiet-action">Sync all</button>
      </div>
      <ul id="nav-sources-6" class="nav-sources">
        <li class="source-row">
          <a
            class="nav-link"
            title="Jira · ferrowick.atlassian.net, project SYN"
            href="/browse?grouping=epic&amp;source=jira"
          >
            <span class="nav-name">Jira</span>
            <span class="nav-count" title="120 items">120</span>
            <span class="source-synced">just now</span>
          </a>
          <button type="button" class="quiet-action source-sync" aria-label="Sync Jira">
            Sync
          </button>
          <p class="source-changes">3 new · 2 changed</p>
        </li>
        <li class="source-row" data-syncing>
          <a
            class="nav-link"
            title="Slack · Ferrowick"
            href="/browse?grouping=epic&amp;source=slack"
          >
            <span class="nav-name">Slack</span>
            <span class="nav-count" title="48 items">48</span>
            <span class="source-synced">Syncing…</span>
          </a>
          <button type="button" class="quiet-action source-sync" aria-label="Sync Slack" disabled>
            Sync
          </button>
        </li>
        <li class="source-row">
          <a
            class="nav-link"
            title="A folder on this Mac"
            href="/browse?grouping=epic&amp;source=folder"
          >
            <svg
              class="icon warning-mark"
              viewBox="0 0 16 16"
              role="img"
              aria-label="Its last sync didn't work"
            >
              <path d="M8 2.5l6 10.5H2zM8 6.5v3M8 11.25v.25" />
            </svg>
            <span class="nav-name">Launch docs</span>
            <span class="nav-count" title="3 items">3</span>
            <span class="source-synced">2 days ago</span>
          </a>
          <button type="button" class="quiet-action source-sync" aria-label="Sync Launch docs">
            Sync
          </button>
          <p class="source-problem" role="alert">
            Oriel can't read this folder now. Check it's still there.
          </p>
        </li>
        <li>
          <a class="nav-link nav-more add-source" href="/settings/connections">Add a source</a>
        </li>
      </ul>
    </section>
  </aside>
  <div class="shell-main"></div>
</div>
```

Sync here is hidden by `opacity`, not removed, so it stays in the tab order: tab into the rows above to see it. The folder's problem sentence is illustrative; the words are whatever the source's connector says.

### Folded, on a wide screen

Folded (`.shell[data-folded]`, above 760px), the sidebar is a 3.25rem strip of icons, and the frame's curve follows the column's left edge: the brand, the fold button, Search and New thread, Window, and Settings. Every `.sidebar-label` is still there for readers, visually hidden; Needs you, Workstreams, Done and Sources are not drawn (`@media (min-width: 761px)` in `window.css`). The fold button carries the count of threads waiting on the person, as a `.bar-count`. The search icon unfolds the sidebar and puts focus in the field.

```html specimen id=folded title="Folded: icons only, the fold button counts what waits on you" height=420 pad=0
<div class="shell" data-folded>
  <aside id="sidebar-f" class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        <span class="sidebar-label">Oriel</span>
      </a>
      <button
        type="button"
        class="sidebar-fold"
        aria-controls="sidebar-f"
        aria-expanded="false"
        aria-describedby="tip-unfold"
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M6 2.5v11" />
        </svg>
        <span class="visually-hidden">Show sidebar, 11 threads waiting on you</span>
        <span class="bar-count" aria-hidden="true">11</span>
      </button>
      <span id="tip-unfold" role="tooltip" popover="manual" class="tooltip"
        >Show the sidebar (⌘\)</span
      >
    </div>
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <button type="button" class="sidebar-search-open nav-link">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="sidebar-label">Search threads</span>
        </button>
        <span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
          >Search threads</span
        >
        <label class="sidebar-search-field">
          <span class="visually-hidden">Search threads</span>
          <input
            type="text"
            role="combobox"
            placeholder="Search threads"
            aria-expanded="false"
            aria-autocomplete="list"
          />
        </label>
        <a
          href="/threads/new"
          class="sidebar-new nav-link"
          aria-label="New thread"
          aria-describedby="tip-new-f"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </a>
        <span id="tip-new-f" role="tooltip" popover="manual" class="tooltip"
          >New thread: start from nothing, such as a plan for a new epic</span
        >
      </div>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5 9.5h6M5 11.5h4" />
        </svg>
        <span class="sidebar-label">Window</span>
      </a>
    </nav>
    <nav class="sidebar-foot" aria-label="Settings">
      <a href="/settings" class="nav-link">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h6.25M12.25 4.5h1.25M2.5 11.5h1.25M7.25 11.5h6.25" />
          <circle cx="10.5" cy="4.5" r="1.75" />
          <circle cx="5.5" cy="11.5" r="1.75" />
        </svg>
        <span class="sidebar-label">Settings</span>
      </a>
    </nav>
  </aside>
  <div class="shell-main">
    <div class="page"><p class="ws-note">The page goes here, 3.25rem from the edge.</p></div>
  </div>
</div>
```

Settings sits right under Window here only because this specimen draws no Needs you or sources: folded, those are `display: none`, so the foot's `margin-top: auto` puts Settings at the bottom of a full-height strip in the app.

### Narrow screens: the bar and the drawer (760px and under)

At 760px and under there's no column. A `.bar` heads the page instead: the menu button (`.bar-menu`), which counts the threads waiting on the person, and the brand. The bar is the frame here, in `--frame` with no line under it, and the page's top corners curve from its lower edge. The sidebar becomes a drawer, `min(18rem, 86vw)` wide, off screen and out of the tab order (`visibility: hidden`) until the menu opens it; `.shell[data-drawer]` slides it in over a `--scrim` backdrop (`.shell[data-drawer] .sidebar` and `.drawer-backdrop` in `window.css`). The fold button isn't drawn, and the folded state doesn't apply.

```html specimen id=narrow-closed title="390: the bar, the drawer closed" width=390 height=260 pad=0
<div class="shell">
  <aside id="sidebar-n" class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        <span class="sidebar-label">Oriel</span>
      </a>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link" aria-current="page"><span class="sidebar-label">Window</span></a>
    </nav>
  </aside>
  <button type="button" class="drawer-backdrop" tabindex="-1" aria-hidden="true"></button>
  <div class="shell-main">
    <header class="bar">
      <button type="button" class="bar-menu" aria-controls="sidebar-n" aria-expanded="false">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
        <span class="visually-hidden">Open the sidebar, 3 threads waiting on you</span>
        <span class="bar-count" aria-hidden="true">3</span>
      </button>
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        Oriel
      </a>
    </header>
    <div class="page"><p class="ws-note">The page goes here, under the bar.</p></div>
  </div>
</div>
```

```html specimen id=narrow-open title="390: the drawer open" width=390 height=640 pad=0
<div class="shell" data-drawer>
  <aside id="sidebar-d" class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        <span class="sidebar-label">Oriel</span>
      </a>
    </div>
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <label class="sidebar-search-field">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="visually-hidden">Search threads</span>
          <input
            type="text"
            role="combobox"
            placeholder="Search threads"
            aria-expanded="false"
            aria-autocomplete="list"
          />
        </label>
        <a href="/threads/new" class="sidebar-new nav-link" aria-label="New thread">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </a>
      </div>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link" aria-current="page">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5 9.5h6M5 11.5h4" />
        </svg>
        <span class="sidebar-label">Window</span>
      </a>
    </nav>
    <nav class="sidebar-needs" aria-label="Needs you" tabindex="-1">
      <ul class="nav-waiting">
        <li>
          <a href="/threads/whats-in-here" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="reply"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">What's in here?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
                <span class="nav-waiting-workstream">Saved cards launch</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/estimates" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Which stories here still need estimates?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/plan-gift-cards" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="held"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Plan gift cards</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="held">Message held</span>
                <span class="nav-waiting-workstream">Gift cards</span>
              </span>
            </span>
          </a>
        </li>
      </ul>
    </nav>
    <nav class="sidebar-workstreams" aria-label="Workstreams">
      <div class="fold-head">
        <h2 class="rail-title">
          <button
            type="button"
            class="fold-toggle"
            aria-expanded="true"
            aria-controls="nav-workstreams-d"
          >
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
            Workstreams
          </button>
        </h2>
      </div>
      <ul id="nav-workstreams-d" class="nav-workstreams">
        <li>
          <div class="nav-workstream-row">
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/gift-cards" class="nav-link"
                ><span class="nav-name">Gift cards</span
                ><span class="nav-count" title="0 items">0</span></a
              >
            </div>
          </div>
        </li>
        <li>
          <div class="nav-workstream-row">
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/checkout-v2" class="nav-link"
                ><span class="nav-name">Checkout v2: phone wallets and saved cards</span
                ><span class="nav-count" title="17 items">17</span></a
              >
            </div>
          </div>
        </li>
      </ul>
    </nav>
    <nav class="sidebar-foot" aria-label="Settings">
      <a href="/settings" class="nav-link">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h6.25M12.25 4.5h1.25M2.5 11.5h1.25M7.25 11.5h6.25" />
          <circle cx="10.5" cy="4.5" r="1.75" />
          <circle cx="5.5" cy="11.5" r="1.75" />
        </svg>
        <span class="sidebar-label">Settings</span>
      </a>
    </nav>
  </aside>
  <button type="button" class="drawer-backdrop" tabindex="-1" aria-hidden="true"></button>
  <div class="shell-main">
    <header class="bar">
      <button type="button" class="bar-menu" aria-controls="sidebar-d" aria-expanded="true">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
        <span class="visually-hidden">Open the sidebar, 3 threads waiting on you</span>
        <span class="bar-count" aria-hidden="true">3</span>
      </button>
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        Oriel
      </a>
    </header>
    <div class="page"><p class="ws-note">The page, under the scrim.</p></div>
  </div>
</div>
```

## States

Hover and focus here are forced with the workshop's `ws-` classes, which copy window.css's own rules. Tab into any specimen above for the real thing.

```html specimen id=state-rest title="Rest, and current" state=rest height=170 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/" class="nav-link" aria-current="page"
        ><span class="nav-name">Window (current page)</span></a
      >
      <a href="/workstreams/gift-cards" class="nav-link"
        ><span class="nav-name">Gift cards</span><span class="nav-count" title="0 items">0</span></a
      >
      <a href="/threads/whats-in-here" class="nav-link nav-thread"
        ><span class="state-dot" data-state="working" data-waiting="reply" title="Your turn"></span
        ><span class="nav-name">What's in here?</span></a
      >
      <button type="button" class="nav-link nav-more">3 more</button>
    </nav>
  </aside>
  <div class="shell-main"></div>
</div>
```

```html specimen id=state-hover title="Hover" state=hover height=200 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <div class="sidebar-head">
      <a href="/" class="brand"><span class="sidebar-label">Oriel</span></a>
      <button type="button" class="sidebar-fold ws-hover" aria-expanded="true">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M6 2.5v11" />
        </svg>
        <span class="visually-hidden">Hide sidebar</span>
      </button>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/workstreams/gift-cards" class="nav-link ws-hover"
        ><span class="nav-name">Gift cards</span><span class="nav-count" title="0 items">0</span></a
      >
      <div class="nav-workstream-row">
        <button type="button" class="nav-disclose ws-hover" aria-expanded="false">
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span class="visually-hidden">Show threads in Saved cards launch</span>
        </button>
        <div class="nav-workstream-menu">
          <a href="/workstreams/saved-cards" class="nav-link"
            ><span class="nav-name">Saved cards launch</span
            ><span class="nav-count" title="6 items">6</span></a
          >
        </div>
      </div>
    </nav>
    <div class="fold-head">
      <h2 class="rail-title">
        <button type="button" class="fold-toggle ws-hover" aria-expanded="false">
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          Done<span class="nav-count">8</span>
        </button>
      </h2>
    </div>
  </aside>
  <div class="shell-main"></div>
</div>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible height=200 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <div class="sidebar-search">
      <div class="sidebar-search-row" role="search">
        <label class="sidebar-search-field ws-focus-within">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.25 10.25L13.5 13.5" />
          </svg>
          <span class="visually-hidden">Search threads</span>
          <input
            type="text"
            role="combobox"
            placeholder="Search threads"
            aria-expanded="false"
            aria-autocomplete="list"
          />
        </label>
        <a href="/threads/new" class="sidebar-new nav-link" aria-label="New thread">
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </a>
      </div>
    </div>
    <nav class="sidebar-pages" aria-label="Pages">
      <a href="/workstreams/gift-cards" class="nav-link ws-focus-visible"
        ><span class="nav-name">Gift cards</span><span class="nav-count" title="0 items">0</span></a
      >
    </nav>
    <div class="fold-head">
      <h2 class="rail-title">
        <button type="button" class="fold-toggle ws-focus-visible" aria-expanded="true">
          <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
          Workstreams
        </button>
      </h2>
    </div>
  </aside>
  <div class="shell-main"></div>
</div>
```

```html specimen id=state-marked title="Needs you, marked for a moment (it fades as the frame loads)" height=130 pad=0
<div class="shell">
  <aside class="sidebar" aria-label="Sidebar">
    <nav class="sidebar-needs" aria-label="Needs you" tabindex="-1" data-shown>
      <ul class="nav-waiting">
        <li>
          <a href="/threads/estimates" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Which stories here still need estimates?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </aside>
  <div class="shell-main"></div>
</div>
```

- **Rest**: rows are muted text with no fill. The **current** row (`aria-current="page"`) is raised on the surface with a hairline ring and medium weight. It marks Window on the overview and Browse, a workstream only while its own page shows and none of its threads does, a thread, New thread, Settings, and Done's "N more" or "N dropped" when that Done tab is the page.
- **Hover**: `.nav-link` takes `--surface-hover` and full text colour. The fold button, disclosure and fold toggles only darken (`.sidebar-fold` also fills).
- **Focus visible**: the global ring, `--border-thick` in `--focus`, 2px out (`:focus-visible` in `window.css`). The search field draws its own ring on the label. Nothing in the sidebar overrides the ring.
- **Active** (pressed): not styled.
- **Disabled**: only Sync and Sync all, as a `.quiet-action` at 0.5 opacity: a source's Sync while it syncs, Sync all while every source does.
- **Busy**: a source syncing says "Syncing…" in the accent, in its row and on the folded line. A thread whose agent is mid-turn, or whose change set is applying, pulses its dot. A workstream with an agent working shows a still `.working-dot`.
- **Error**: a source's problem is a danger line under its row and a `.warning-mark` on its link and on the folded line. A failed search says "Oriel couldn't search just now. Keep typing to try again."
- **Empty**: Needs you draws nothing. Workstreams says "Pick items in the window, or make a workstream from a cluster.", Done "No thread is done yet.", the folded sources line "None yet", and search "No thread matches that."
- **Marked**: when the overview's "N need you" is pressed, Needs you takes focus and its background fades from `--accent-soft` over 1.6s (`.sidebar-needs[data-shown]` in `window.css`). It's a colour fade, so it runs under reduced motion too.

## Keyboard and ARIA

- The sidebar is `aside#sidebar` with `aria-label="Sidebar"`. Its lists are `nav` landmarks labelled "Pages", "Needs you", "Workstreams", "Done" and "Settings"; Sources is a labelled `section`.
- *_⌘\*_ (Ctrl+\ off a Mac) folds and unfolds it on a wide screen (`App` in `packages/web/src/app.tsx`). The fold button says so in its tooltip, and its hidden label says what it does and, folded, how many threads wait: "Show sidebar, 3 threads waiting on you". It sets `aria-expanded` and `aria-controls="sidebar"`. The fold is remembered in this browser (`oriel.sidebar.folded`).
- **Search** is a combobox over a listbox. While results show, the input carries `aria-activedescendant`; ArrowDown and ArrowUp move through results, Enter opens one (at the change set that matched), and Escape clears the field and closes nothing else (`ThreadSearch` in `packages/web/src/sidebar.tsx`). Results are `role="option"`, `tabindex="-1"`.
- **Fold heads and disclosures** are buttons with `aria-expanded` and `aria-controls`. A workstream's disclosure is named "Show threads in {name}" or "Hide threads in {name}".
- **Row actions** are in a context menu on every thread and workstream row: right-click, the Menu key or Shift+F10 opens it; see [Menu](/components/menu). A sideways swipe shows the same actions; the keyboard uses the menu.
- **Needs you** is `nav#needs-you` with `tabindex="-1"`, so the overview's count (`aria-controls="needs-you"`) can move focus to it.
- **The drawer** (760px and under): the menu button opens it and focus moves to its first link. Escape, or a tap on the backdrop, closes it and gives focus back to the menu button (`App` in `packages/web/src/app.tsx`). Escape closes the drawer before the item panel. Closed, the drawer is `visibility: hidden`, so it's out of the tab order. The backdrop is a `tabindex="-1"`, `aria-hidden` button. There's no focus trap while it's open.
- A state dot has no role. In Needs you its meaning is in the words beside it; under a workstream and in Done it has a `title` only, so the thread's state isn't spoken there.
- Folded, every label stays in the accessibility tree (`.sidebar-label` is visually hidden, not removed); the search and New thread icons have tooltips.

## Content

- Section headings are one word: **Workstreams**, **Done**, **Sources**. Needs you has no visible heading.
- A thread is its title, or **New thread** before it has one. A workstream is its name.
- What a thread waits on, exactly: **Needs review**, **Message held**, **Apply stalled**, **Draft to apply**, **Your turn** (`waitingNames` in `packages/web/src/parts.tsx`). States: **Working**, **Done**, **Handed off**, **Dropped** (`stateNames` in `packages/web/src/chip.ts`).
- "More" rows: **{n} more**, and in Done **{n} dropped**.
- Sources: **{n} sources · {when}** ("1 source · just now", "2 sources · not synced"), **Syncing…**, **None yet**. A row's changes: **3 new · 2 changed · 1 removed**. Actions: **Sync**, **Sync all**, **Add a source**.
- Labels for readers: **Hide sidebar** / **Show sidebar**, **Open the sidebar**, each with ", {n} threads waiting on you" when any do; **A source has a problem**; **Its last sync didn't work**; **Sync {source}**.
- Tooltips: **Hide the sidebar (⌘\)**, **Show the sidebar (⌘\)**, **Search threads**, **New thread: start from nothing, such as a plan for a new epic**.
- Counts' titles: **{n} items** on a workstream's count, **{n} agents working** on its working dot.

## Where the app uses it

- The shell: `App` in `packages/web/src/app.tsx`; CSS `.shell` and `.shell-main` in `window.css`.
- The sidebar: `Sidebar` in `packages/web/src/sidebar.tsx`, rendered by `App` in `packages/web/src/app.tsx`; CSS `.sidebar` in `window.css`.
- Head and fold button: `Sidebar` in `packages/web/src/sidebar.tsx`; `.sidebar-fold` in `window.css`.
- Search and New thread: `ThreadSearch` in `packages/web/src/sidebar.tsx`; CSS `.sidebar-search`, `.sidebar-search-row`, `.sidebar-search-field`, `.nav-link.sidebar-search-open`, `.nav-link.sidebar-new`, `.search-results`, `.search-list`, `.search-result`, `.search-result-head`, `.search-result-set` and `.search-result-excerpt` in `window.css`.
- Nav link: `.nav-link` in `window.css`; current `.nav-link[aria-current="page"]` in `window.css`.
- Needs you: `NeedsYou` in `packages/web/src/sidebar.tsx`; CSS `.nav-waiting` in `window.css`. Who waits on the person: `waitsOnUser` in `packages/web/src/view.ts`.
- State dot: `.state-dot` in `window.css`. Working dot: `.working-dot` in `window.css`.
- Workstreams: `Workstreams` in `packages/web/src/sidebar.tsx`, each one `WorkstreamEntry` in `packages/web/src/sidebar.tsx`; `.nav-disclose` and `.nav-threads` in `window.css`.
- Done: `Done` in `packages/web/src/sidebar.tsx`. Fold heads: `FoldHead` in `packages/web/src/sidebar.tsx`; `.fold-head` and `.fold-toggle` in `window.css`.
- Sources: `Sources` in `packages/web/src/sidebar.tsx`; CSS `.sidebar-sources`, `.sources-line`, `.nav-sources`, `.source-row`, `.source-synced`, `.source-changes`, `.source-row .source-problem` and `.add-source` in `window.css`.
- Settings at the foot: `Sidebar` in `packages/web/src/sidebar.tsx`; `.sidebar-foot` in `window.css`.
- Folded: `@media (min-width: 761px)` in `window.css`. The bar: `Bar` in `packages/web/src/app.tsx`; `.bar` and `.bar-count` in `window.css`. The drawer: `.shell[data-drawer] .sidebar` and `.drawer-backdrop` in `window.css`.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` in `window.css`.

## Drift

Status **drifting**. The sidebar is one component, but some of its pieces say the same thing two ways:

- **"More" is two controls under one class.** In Needs you, `.nav-more` is a `<button>` that shows the rest in place (`NeedsYou` in `packages/web/src/sidebar.tsx`); in Workstreams and Done it's a link to another page (`WorkstreamEntry` and `Done` in `packages/web/src/sidebar.tsx`). The overview and Browse have two more "N more" shapes; see [Overview sections](/components/overview-section).
- **Draft to apply and Your turn aren't accented.** They wait on the person (`waitsOnUser` in `packages/web/src/view.ts`) and list in Needs you, but their dot is the working colour and their words are `--in-progress`, while review, held and stalled are the accent (`.nav-waiting-on:is([data-waiting="review"], [data-waiting="held"], [data-waiting="stalled"])` and `.state-dot:is([data-waiting="review"], [data-waiting="held"], [data-waiting="stalled"])` in `window.css`). The state chip has the same gap.
- **Unstyled hooks.** `li.nav-workstream` with `data-current`, and `.nav-source` on a source's link, are in the markup (`WorkstreamEntry` and `Sources` in `packages/web/src/sidebar.tsx`) but have no CSS; the specimens leave them out, because the workshop only accepts classes window.css styles.
- **"Rail" means two things.** The sidebar's headings and empty lines are `.rail-title` and `.rail-empty`, the classes a thread's [right rail](/components/right-rail) uses for its region.

Until it's consolidated, copy what the app does today: a `<button class="nav-link nav-more">` only where the rest appear in place, an `<a class="nav-link nav-more">` where they're on another page; markup thread rows exactly as the specimens show, with `data-state` and `data-waiting` from the thread, and don't add colours for `draft` or `reply` by hand. The fix belongs in one state-to-colour map (see [the drift report](/drift)).
