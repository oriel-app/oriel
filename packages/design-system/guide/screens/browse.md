---
title: Browse
order: 15
summary: Browse as a person opens it from the overview, by epic, on the fixture: its head and count line, its filters, and the clusters with one open.
---

# Browse

## What it shows

Browse is the window's second view: every item in the window, in clusters under a grouping, to look through, pick from and make workstreams of (decision 0027). This is Browse as a person opens it from the overview's tabs: grouped by epic, on the synthetic fixture, with no filter set. The first cluster is open, three of its 14 items shown with **Show 11 more** under them; the rest are closed. The last cluster is Oriel's own, for items from sources that have no epics, so the line above the clusters says what its tag means.

```html specimen id=screen title="Browse by epic, with the sidebar" screen height=900
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
          <a href="/threads/t-whats-in" class="nav-link nav-waiting-link">
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
          <a href="/threads/t-estimate" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Estimate the remaining checkout stories</span>
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
          <a href="/threads/t-signed-off" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="held"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Who signed off the 3-D Secure copy?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="held">Message held</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/t-plan-gift" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Plan gift cards</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="review">Needs review</span>
                <span class="nav-waiting-workstream">Gift cards</span>
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/t-left" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="reply"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">What's left before checkout ships?</span>
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/t-meeting" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="reply"></span>
            <span class="nav-waiting-text">
              <span class="nav-name"
                >I'm meeting the payments team tomorrow morning and want to know what to raise</span
              >
              <span class="nav-waiting-about">
                <span class="nav-waiting-on" data-waiting="reply">Your turn</span>
                <span class="nav-waiting-workstream"
                  >Checkout v2: phone wallets and saved cards</span
                >
              </span>
            </span>
          </a>
        </li>
        <li>
          <a href="/threads/t-built" class="nav-link nav-waiting-link">
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
        <li>
          <a href="/threads/t-rename" class="nav-link nav-waiting-link">
            <span class="state-dot" data-state="working" data-waiting="review"></span>
            <span class="nav-waiting-text">
              <span class="nav-name">Rename the epic and plan gift cards in it</span>
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
              <a href="/workstreams/ws-gift" class="nav-link">
                <span class="nav-name">Gift cards</span>
                <span class="nav-count" title="0 items">0</span>
              </a>
            </div>
          </div>
        </li>
        <li>
          <div class="nav-workstream-row">
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/ws-declined" class="nav-link">
                <span class="nav-name">Declined card retry</span>
                <span class="nav-count" title="1 item">1</span>
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
              <a href="/workstreams/ws-saved" class="nav-link">
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
              aria-expanded="false"
              aria-controls="nav-threads-boarding"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden">Show threads in Boarding passes and gate scanning</span>
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/ws-boarding" class="nav-link">
                <span class="nav-name">Boarding passes and gate scanning</span>
                <span class="nav-count" title="9 items">9</span>
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
              aria-controls="nav-threads-weather"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden">Show threads in Weather disruptions and rebooking</span>
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/ws-weather" class="nav-link">
                <span class="nav-name">Weather disruptions and rebooking</span>
                <span class="nav-count" title="12 items">12</span>
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
              aria-controls="nav-threads-checkout"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden"
                >Show threads in Checkout v2: phone wallets and saved cards</span
              >
            </button>
            <div class="nav-workstream-menu">
              <a href="/workstreams/ws-checkout" class="nav-link">
                <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
                <span class="nav-count" title="17 items">17</span>
              </a>
            </div>
          </div>
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
            Done<span class="nav-count">3</span>
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
        <span class="sources-line">1 source · just now</span>
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
    <header class="bar">
      <button type="button" class="bar-menu" aria-controls="sidebar" aria-expanded="false">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
        <span class="visually-hidden">Open the sidebar, 11 threads waiting on you</span>
        <span class="bar-count" aria-hidden="true">11</span>
      </button>
      <a href="/" class="brand">
        <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
          <path d="M2.5 8.5h15M10 8.5v9" />
        </svg>
        Oriel
      </a>
    </header>
    <div class="window-layout">
      <main class="window" aria-busy="false">
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
          <p class="counts">
            29 items in 3 clusters
            <span class="fixture" title="Synthetic fixture data, not your index"
              >Fixture · 2 Nov 2026</span
            >
          </p>
        </div>
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
              placeholder="Search items by key, title or text"
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
            <select>
              <option value="" selected>Any status</option>
              <option value="todo">To do</option>
              <option value="in-progress">In progress</option>
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
        </form>
        <p class="derived-note">
          <span class="derived-tag">Oriel rule</span>
          marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
        </p>
        <div class="clusters" data-grouping="epic" data-anchored>
          <section class="cluster" data-open>
            <h2 class="cluster-head">
              <label class="pick anchor-pick" title="Pick SYN-1 itself, not its items">
                <input
                  type="checkbox"
                  aria-label="Pick Checkout v2: phone wallets and saved cards"
                />
              </label>
              <button
                type="button"
                class="cluster-toggle"
                aria-expanded="true"
                aria-controls="items-epic-SYN-1"
              >
                <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span class="cluster-name">
                  <span class="cluster-label">Checkout v2: phone wallets and saved cards</span>
                  <span class="key">SYN-1</span>
                </span>
                <span class="cluster-details">
                  <span class="origin" title="This cluster is in Jira">Jira</span>
                  <span class="cluster-meta">
                    <span class="count">14 items</span>
                    <span class="points-sum"
                      >29 pts · <span class="unestimated">3 unestimated</span></span
                    >
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
                >Make a workstream of all 14 items in Checkout v2: phone wallets and saved cards as
                they are now</span
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
                <span class="assignee"
                  ><span class="avatar" aria-hidden="true">CY</span>Chen Yuting</span
                >
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
                <span class="assignee"
                  ><span class="avatar" aria-hidden="true">AO</span>Amara Okafor</span
                >
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
                <span class="assignee none"
                  ><span class="avatar" aria-hidden="true"></span>Unassigned</span
                >
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
                <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span class="cluster-name">
                  <span class="cluster-label">Weather disruptions and rebooking</span>
                  <span class="key">SYN-3</span>
                </span>
                <span class="cluster-details">
                  <span class="origin" title="This cluster is in Jira">Jira</span>
                  <span class="cluster-meta">
                    <span class="count">12 items</span>
                    <span class="points-sum"
                      >29 pts · <span class="unestimated">5 unestimated</span></span
                    >
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
                <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span class="cluster-name"
                  ><span class="cluster-label">No epics in this source</span></span
                >
                <span class="cluster-details">
                  <span
                    class="origin derived"
                    title="Oriel made this cluster; the source doesn't have it"
                    ><span class="derived-tag">Oriel rule</span>Items from sources that have no
                    epics</span
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
      </main>
    </div>
  </div>
</div>
```

## Built from

- [Sidebar](/components/sidebar): the shell, with Window current, as on the overview.
- [Page head](/components/page-head#browse-s-head): the page column, the head and its count line with the fixture tag.
- [Tabs](/components/tabs): Overview and Browse as links, then Group by as buttons.
- [Text field](/components/text-field): the item search.
- [Select](/components/select): the source, status, assignee and workstream filters.
- [List rows](/components/list-row): the Oriel rule note, the cluster rows and the item rows, with Show 11 more.
- [Meter](/components/meter): each cluster's status bar.
- [Checkbox and radio](/components/checkbox-radio): the picks, hidden until a row is pointed at.
- [Button](/components/button): Make workstream, Show 11 more.
- [Tooltip](/components/tooltip): Make workstream's, which says exactly what it copies.

## Notes for review

- **The fixture tag sits with the counts, not the title.** On a person's own index the line is only "29 items in 3 clusters"; on the fixture the dashed tag is the only thing on the page saying the data isn't theirs. It's faint, `--text-xs`, at the far end of the head.
- **Two kinds of tabs on one row.** The view tabs are links (`aria-current`) and Group by is buttons (`aria-pressed`), drawn alike. Correct for each, but a sighted person sees one row of six tabs; see [Tabs](/components/tabs).
- **Make workstream waits for the pointer.** Each closed cluster keeps 7rem on its right for it, empty at rest, so the meta columns end short of the frame. The anchor's checkbox is hidden the same way until the heading is pointed at.
- **The picked-items bar isn't here.** It shows only once something is picked or the person came to add to a workstream, fixed at the page's foot (see [Select](/components/select)). Its own classes aren't on a component page's list, so this screen leaves it out; the adding note is on [Page head](/components/page-head#browse-s-head).
- **The clusters frame ignores Broadsheet's list style.** `.clusters` draws a `--line` border on `--surface` in every theme, where Broadsheet's other lists follow `--list-frame`; see [List rows](/components/list-row#drift).
