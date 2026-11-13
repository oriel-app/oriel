---
title: Workstream
order: 30
summary: A workstream's page as a person opens it from the sidebar: its head, the Ask box, its threads and its items, at 1280 and at 390.
---

# Workstream

## What it shows

A workstream's page, opened from the sidebar, where it is the current row with its threads open under it. The head is the name (rename it in place), Mark done and Delete. Under it are the Ask box, the workstream's threads with what each waits on, and its items, each with its type mark, key, title and status, and a remove × that shows on hover. Two items the index no longer has sit at the end, and the versions are folded at the foot.

```html specimen id=screen title="A workstream, with the sidebar" screen height=1300
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
      <a href="/" class="nav-link">
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
        <li data-current>
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
              <a href="/workstreams/ws-checkout" class="nav-link" aria-current="page">
                <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
                <span class="working-dot" title="1 agent working"></span>
                <span class="nav-count" title="17 items">17</span>
              </a>
            </div>
          </div>
          <ul id="nav-threads-checkout" class="nav-threads">
            <li>
              <a href="/threads/t-estimate" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="review"
                  title="Needs review"
                ></span>
                <span class="nav-name">Estimate the remaining checkout stories</span>
              </a>
            </li>
            <li>
              <a href="/threads/t-signed-off" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="held"
                  title="Message held"
                ></span>
                <span class="nav-name">Who signed off the 3-D Secure copy?</span>
              </a>
            </li>
            <li>
              <a href="/threads/t-left" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="reply"
                  title="Your turn"
                ></span>
                <span class="nav-name">What's left before checkout ships?</span>
              </a>
            </li>
            <li>
              <a href="/threads/t-rollout" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="agent"
                  title="Agent working"
                ></span>
                <span class="nav-name">Draft the saved cards rollout note</span>
              </a>
            </li>
            <li>
              <a href="/threads/t-retry" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="apply"
                  title="Applying…"
                ></span>
                <span class="nav-name">Retry the gift card estimates</span>
              </a>
            </li>
            <li><a href="/workstreams/ws-checkout" class="nav-link nav-more">5 more</a></li>
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
    <main class="page">
      <header class="workstream-head">
        <div class="workstream-title-row">
          <input
            class="workstream-title"
            value="Checkout v2: phone wallets and saved cards"
            aria-label="Workstream name"
            maxlength="120"
          />
          <div class="workstream-actions">
            <button
              type="button"
              class="head-action"
              aria-label="Mark done: Checkout v2: phone wallets and saved cards"
            >
              <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.75" />
                <path d="M5.5 8.25l1.75 1.75L10.75 6.5" />
              </svg>
            </button>
            <span role="tooltip" popover="manual" class="tooltip">Mark done</span>
            <button
              type="button"
              class="head-action"
              data-danger
              aria-label="Delete Checkout v2: phone wallets and saved cards…"
            >
              <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4.25 4.5l.6 8.5h6.3l.6-8.5M6.75 7v3.75M9.25 7v3.75"
                />
              </svg>
            </button>
            <span role="tooltip" popover="manual" class="tooltip">Delete…</span>
          </div>
        </div>
        <p class="workstream-origin">Copied from a cluster in the epic grouping · 17 items · v3</p>
      </header>
      <form class="chat-input workstream-ask">
        <textarea
          class="chat-input-field"
          rows="2"
          placeholder="Ask about these 17 items…"
          aria-label="Ask about this workstream"
        ></textarea>
        <div class="chat-input-foot">
          <span class="chat-input-reads">Reads 17 items · v3</span>
          <button type="submit" class="button" disabled>Ask</button>
        </div>
      </form>
      <section class="section">
        <h2 class="section-title">Threads</h2>
        <ul class="thread-list">
          <li>
            <a class="thread-link" href="/threads/t-estimate">
              <span class="thread-link-title">Estimate the remaining checkout stories</span>
              <span class="state-chip" data-state="working" data-waiting="review"
                >Needs review</span
              >
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-signed-off">
              <span class="thread-link-title">Who signed off the 3-D Secure copy?</span>
              <span class="state-chip" data-state="working" data-waiting="held">Message held</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-left">
              <span class="thread-link-title">What's left before checkout ships?</span>
              <span class="state-chip" data-state="working" data-waiting="reply">Your turn</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-rollout">
              <span class="thread-link-title">Draft the saved cards rollout note</span>
              <span class="state-chip" data-state="working" data-waiting="agent"
                >Agent working</span
              >
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-retry">
              <span class="thread-link-title">Retry the gift card estimates</span>
              <span class="state-chip" data-state="working" data-waiting="apply">Applying…</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-split">
              <span class="thread-link-title">Split the phone wallet story</span>
              <span class="state-chip" data-state="handed-off">Handed off</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-no-estimate">
              <span class="thread-link-title">Which stories have no estimate?</span>
              <span class="state-chip" data-state="done">Done</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-whats-in">
              <span class="thread-link-title">What's in here?</span>
              <span class="state-chip" data-state="done">Done</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-blocking">
              <span class="thread-link-title">Is anything blocking phone wallets?</span>
              <span class="state-chip" data-state="dropped">Dropped</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
          <li>
            <a class="thread-link" href="/threads/t-who">
              <span class="thread-link-title">Who is on the saved cards stories?</span>
              <span class="state-chip" data-state="dropped">Dropped</span>
              <span class="thread-link-at"
                ><time datetime="2026-11-04T09:14:00Z" title="Wed, Nov 4, 09:14"
                  >just now</time
                ></span
              >
            </a>
          </li>
        </ul>
      </section>
      <section class="section">
        <div class="section-head">
          <h2 class="section-title">Items</h2>
          <button type="button" class="quiet-action">Add from the window</button>
        </div>
        <ul class="members">
          <li class="member" data-item="jira:SYN-1">
            <span class="type" data-type="epic" title="Epic"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-1"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-1</a
            >
            <span class="member-title">Checkout v2: phone wallets and saved cards</span>
            <span class="status" data-category="in-progress">In Progress</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-1">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-1 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-3">
            <span class="type" data-type="epic" title="Epic"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-3"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-3</a
            >
            <span class="member-title">Weather disruptions and rebooking</span>
            <span class="status" data-category="in-progress">In Progress</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-3">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-3 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-10">
            <span class="type" data-type="task" title="Task"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-10"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-10</a
            >
            <span class="member-title">Remove the legacy web-view checkout</span>
            <span class="status" data-category="todo">To Do</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-10">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-10 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-21">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-21"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-21</a
            >
            <span class="member-title">Update the payment declined error message</span>
            <span class="status" data-category="in-progress">In Progress</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-21">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-21 from this workstream</span
            >
          </li>
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
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-23 from this workstream</span
            >
          </li>
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
            <button type="button" class="remove-member" aria-label="Remove SYN-41">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-41 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-57">
            <span class="type" data-type="task" title="Task"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-57"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-57</a
            >
            <span class="member-title">Checkout analytics: drop-off by step</span>
            <span class="status" data-category="todo">To Do</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-57">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-57 from this workstream</span
            >
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
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-74 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-86">
            <span class="type" data-type="bug" title="Bug"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-86"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-86</a
            >
            <span class="member-title">Currency shown twice on the payment button</span>
            <span class="status" data-category="done">Done</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-86">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-86 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-87">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-87"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-87</a
            >
            <span class="member-title">Pay with a phone wallet</span>
            <span class="status" data-category="done">Done</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-87">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-87 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-92">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-92"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-92</a
            >
            <span class="member-title">Show the fare breakdown before payment</span>
            <span class="status" data-category="in-progress">In Progress</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-92">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-92 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-98">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-98"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-98</a
            >
            <span class="member-title">Apply promo codes at checkout</span>
            <span class="status" data-category="todo">To Do</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-98">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-98 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-99">
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
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-99 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-104">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-104"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-104</a
            >
            <span class="member-title">Handle 3-D Secure challenges in the native checkout</span>
            <span class="status" data-category="in-progress">In Progress</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-104">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-104 from this workstream</span
            >
          </li>
          <li class="member" data-item="jira:SYN-111">
            <span class="type" data-type="story" title="Story"></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-111"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-111</a
            >
            <span class="member-title">Retry a payment without losing the selected seats</span>
            <span class="status" data-category="done">Done</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-111">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-111 from this workstream</span
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
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-900 from this workstream</span
            >
          </li>
          <li class="member gone" data-item="jira:SYN-901">
            <span class="type" data-type=""></span>
            <a
              class="key source-link"
              href="https://ferrowick.atlassian.net/browse/SYN-901"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-901</a
            >
            <span class="member-title">Not in the index</span>
            <button type="button" class="remove-member" aria-label="Remove SYN-901">×</button>
            <span role="tooltip" popover="manual" class="tooltip"
              >Remove SYN-901 from this workstream</span
            >
          </li>
        </ul>
      </section>
      <details class="history">
        <summary>3 versions</summary>
        <ol class="changes">
          <li>
            <span>v3</span>
            <span
              >Added SYN-900, SYN-901 · by the agent in
              <a href="/threads/t-estimate">Estimate the remaining checkout stories</a></span
            >
            <span
              ><time datetime="2026-11-04T09:10:00Z" title="Wed, Nov 4, 09:10"
                >5 min ago</time
              ></span
            >
          </li>
          <li>
            <span>v2</span>
            <span>Added SYN-3</span>
            <span
              ><time datetime="2026-11-03T12:00:00Z" title="Tue, Nov 3, 12:00"
                >yesterday</time
              ></span
            >
          </li>
          <li>
            <span>v1</span>
            <span>Made with 14 items</span>
            <span
              ><time datetime="2026-11-01T09:00:00Z" title="Sun, Nov 1, 09:00"
                >3 days ago</time
              ></span
            >
          </li>
        </ol>
      </details>
    </main>
  </div>
</div>
```

## An outside tool's change

A program the person connected to Oriel's MCP door (decision 0058) changes a workstream as itself. Its version names the tool, by the name the person gave it, as "by Codex, an outside tool". While it is the workstream's latest version, the versions are open, and Undo sits beside it: what the tool added comes out, or what it took out goes back, as the person's own change. Once anything changes the workstream after it, the Undo goes, and the versions fold as usual.

```html specimen id=tool-change title="A tool's latest change, with its Undo"
<details class="history" open>
  <summary>2 versions</summary>
  <ol class="changes">
    <li>
      <span>v2</span>
      <span
        >Removed SYN-23 · by Codex, an outside tool
        <button type="button" class="quiet-action">Undo</button></span
      >
      <span><time datetime="2026-11-05T09:10:00Z" title="Thu, Nov 5, 09:10">just now</time></span>
    </li>
    <li>
      <span>v1</span>
      <span>Made with 14 items</span>
      <span><time datetime="2026-11-01T09:00:00Z" title="Sun, Nov 1, 09:00">4 days ago</time></span>
    </li>
  </ol>
</details>
```

- **Where:** `History` in `packages/web/src/workstream-page.tsx` draws it, and `updateWorkstream` in `packages/web/src/workstream.ts` runs its Undo, which the server's `views` in `packages/server/src/views.ts` gives the version.
- **The words:** "· by {name}, an outside tool". Never what the tool says of itself, only the name the person gave it.

## An empty workstream

A workstream that holds nothing, as one a conversation made, suggests up to five items instead: first what its threads' answers named as chips, in the order they named them, then the top of Not in a workstream yet. Each row's + adds it through the item panel's add, with its Undo in the window's stack; the rest stay to add while all the workstream holds came from them. With nothing to suggest, the list is one short line: "No items."

```html specimen id=empty-suggests title="An empty workstream's suggestions"
<section class="section">
  <div class="section-head">
    <h2 class="section-title">Items</h2>
    <button type="button" class="quiet-action">Add from the window</button>
  </div>
  <h3 class="section-title suggested-title">Suggested</h3>
  <ul class="members">
    <li class="member" data-item="jira:SYN-99">
      <span class="type" data-type="story" title="Story"></span>
      <span class="key">SYN-99</span>
      <span class="member-title">Save a card for next time</span>
      <span class="status" data-category="todo">To Do</span>
      <button type="button" class="add-member" aria-label="Add SYN-99">+</button>
    </li>
    <li class="member" data-item="jira:SYN-104">
      <span class="type" data-type="story" title="Story"></span>
      <span class="key">SYN-104</span>
      <span class="member-title">Handle 3-D Secure challenges in the native checkout</span>
      <span class="status" data-category="in-progress">In Progress</span>
      <button type="button" class="add-member" aria-label="Add SYN-104">+</button>
    </li>
    <li class="member" data-item="jira:SYN-4">
      <span class="type" data-type="epic" title="Epic"></span>
      <span class="key">SYN-4</span>
      <span class="member-title">Vehicle and freight reservations</span>
      <span class="status" data-category="todo">To Do</span>
      <button type="button" class="add-member" aria-label="Add SYN-4">+</button>
    </li>
  </ul>
</section>
```

- **Where:** `WorkstreamPage` in `packages/web/src/workstream-page.tsx` draws it from `suggested`, which `views` in `packages/server/src/views.ts` puts on an empty workstream's view, and `viewed` in `packages/web/src/workstream.ts` keeps.
- **The words:** "Suggested", and each + is "Add {key} to “{name}”" on its tooltip. No sentence says what the list is.

## Built from

- [Sidebar](/components/sidebar): the shell, Needs you, the current workstream with its threads and "5 more", Done, Sources and Settings; and at 390, the bar with its menu.
- [Page head](/components/page-head): the workstream's head, its name field, Mark done and Delete, and where it came from.
- [Icon button](/components/icon-button): Mark done and Delete (`.head-action`), the remove ×, a suggestion's + and the sidebar's disclosures.
- [Tooltip](/components/tooltip): on Mark done, Delete, each remove × and each +.
- [Chat input](/components/chat-input): the workstream's Ask box.
- [Button](/components/button): Ask, and Add from the window.
- [Overview sections](/components/overview-section): the small-caps section titles, with the action beside Items.
- [List rows](/components/list-row): the thread rows, the item rows and the folded versions.
- [State chip, status and counts](/components/badge): the state chips and dots, the type marks and the item statuses.
- [Text field](/components/text-field): the name, a field with no frame until it is pointed at.

## Notes for review

- **Two pills side by side.** The threads' `.state-chip` and the items' `.status` are on one page, a section apart, with different corners (`--radius-lg` against `--radius-sm`) and different colour maps: "Done" is the same green in both, but "In Progress" and "Your turn" share a blue that means two things. See [State chip, status and counts](/components/badge#drift).
- **The Ask box is flat.** The overview's composer is a thread's, raised in a dock at the page's foot; here the same `ChatInput` sits flat under the head. See [Chat input](/components/chat-input).
- **At 390 an item loses its status.** Window.css drops `.member .status` and `.thread-link-at` on a narrow screen, so a phone shows which items are in the workstream but not whether any is done; the threads keep their chips. The name, an `<input>`, is cut mid-word ("…phone wallets and sa") with no ellipsis, since a field can't have one.
- **Remove × is hidden until hover.** A keyboard user meets 17 × buttons in the tab order, one per item, each visible only while focused. That's the app's choice; the tooltip names the key ("Remove SYN-23 from this workstream").
- **The page column is narrower than the overview's.** `.page` caps the column at 52rem and centres it, so at 1280 the workstream has room either side, while the overview runs the full width of `.shell-main`. Going from one to the other, the content's left edge moves about 100px right. The sidebar is the same on both.
- **Unstyled hooks left out.** The app wraps the page in `div.drop-page` and sets `main.page.workstream-page` and `li.nav-workstream`; none is documented by a component (`.drop-page` only sets a minimum height, the others have no rule), so this screen leaves them out. The same goes for the context menu and swipe wrappers around each thread and workstream row.
