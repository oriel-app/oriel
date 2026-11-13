---
title: Overview
order: 10
summary: The window's overview as a person opens it, with the sidebar beside it, at 1280 and at 390.
---

# Overview

## What it shows

The overview as a person opens it on a normal morning: the sidebar with what needs them, the view tabs and the counts strip, a headline with its question to start from and the review links nobody has opened, every open workstream with its status bar, what isn't in a workstream yet under the Oriel rule that found it, and who has work in progress, the two columns' heads on one line, and the composer at the page's foot. Nothing has moved in this window for a while, so every spark is flat and every row says "none moved".

```html specimen id=screen title="The overview, with the sidebar" screen height=900
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
    <main class="overview" aria-busy="false">
      <div class="overview-top">
        <nav class="tabs view-tabs" aria-label="Window">
          <a href="/" aria-current="page">Overview</a>
          <a href="/browse?grouping=epic">Browse</a>
        </nav>
        <p class="overview-counts" data-section="strip">
          <span class="overview-since">In the last 90 days:</span>
          <button type="button" class="overview-stat" aria-expanded="false" disabled>
            <strong>0</strong> items changed
          </button>
          <span class="overview-stat"><strong>0</strong> workstreams moved</span>
          <button type="button" class="overview-stat" aria-controls="needs-you">
            <strong>11</strong> need you
          </button>
          <span class="overview-stat"><strong>16</strong> not in a workstream</span>
        </p>
      </div>
      <section
        class="overview-headlines"
        data-questions
        data-section="headlines"
        aria-label="Headlines"
      >
        <p class="overview-headline" data-headline="top">
          <span class="overview-headline-label" title="Oriel rule: An epic no workstream holds"
            >Top not in a workstream</span
          >
          <span class="overview-headline-body" id="headline-top"
            ><a
              class="overview-title"
              href="https://ferrowick.atlassian.net/browse/SYN-4"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="key">SYN-4</span> Vehicle and freight reservations</a
            >
            <span class="overview-sub">Jira · 2 changed this week</span></span
          >
          <span class="headline-asks"
            ><button type="button" class="ask-question" aria-describedby="headline-top">
              Should Vehicle and freight reservations become a workstream?
            </button></span
          >
        </p>
        <p class="overview-headline" data-headline="unopened">
          <span class="overview-headline-label">3 review links not opened</span>
          <span class="overview-headline-body review-links"
            ><a class="overview-title" href="/threads/t-estimates"
              >Which stories here still need estimates?</a
            ><button type="button" class="overview-more">2 more</button></span
          >
        </p>
      </section>
      <div class="overview-columns">
        <div class="overview-main">
          <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
            <h2 class="overview-head">
              <span>Workstreams</span><span class="overview-count">6</span>
            </h2>
            <ul class="overview-rows">
              <li class="overview-row overview-workstream" data-workstream="ws-declined">
                <a class="overview-title overview-workstream-name" href="/workstreams/ws-declined"
                  >Declined card retry</a
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
                  aria-label="1 in progress"
                  title="1 in progress"
                >
                  <span class="segment in-progress" style="flex-grow: 1"></span>
                </span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"><span>1 Jira</span></span>
              </li>
              <li class="overview-row overview-workstream" data-workstream="ws-gift">
                <a class="overview-title overview-workstream-name" href="/workstreams/ws-gift"
                  >Gift cards</a
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
                <span class="status-bar empty"></span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"><span>No items</span></span>
              </li>
              <li class="overview-row overview-workstream" data-workstream="ws-saved">
                <a class="overview-title overview-workstream-name" href="/workstreams/ws-saved"
                  >Saved cards launch</a
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
                  aria-label="2 in progress, 1 to do"
                  title="2 in progress, 1 to do"
                >
                  <span class="segment in-progress" style="flex-grow: 2"></span>
                  <span class="segment todo" style="flex-grow: 1"></span>
                </span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"
                  ><span>3 Folder · 3 Jira</span><span>1 waiting on you</span
                  ><span
                    class="overview-signal"
                    title="Oriel rule: A member in progress with no update in 14 days"
                    >1 in progress, no update in 14 days</span
                  ></span
                >
              </li>
              <li class="overview-row overview-workstream" data-workstream="ws-checkout">
                <a class="overview-title overview-workstream-name" href="/workstreams/ws-checkout"
                  >Checkout v2: phone wallets and saved cards</a
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
                  aria-label="5 done, 6 in progress, 4 to do"
                  title="5 done, 6 in progress, 4 to do"
                >
                  <span class="segment done" style="flex-grow: 5"></span>
                  <span class="segment in-progress" style="flex-grow: 6"></span>
                  <span class="segment todo" style="flex-grow: 4"></span>
                </span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"
                  ><span>15 Jira</span><span>8 waiting on you · 3 done</span
                  ><span
                    class="overview-signal"
                    title="Oriel rule: A member in progress with no update in 14 days"
                    >3 in progress, no update in 14 days</span
                  ></span
                >
              </li>
              <li class="overview-row overview-workstream" data-workstream="ws-boarding">
                <a class="overview-title overview-workstream-name" href="/workstreams/ws-boarding"
                  >Boarding passes and gate scanning</a
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
                  aria-label="4 in progress, 5 to do"
                  title="4 in progress, 5 to do"
                >
                  <span class="segment in-progress" style="flex-grow: 4"></span>
                  <span class="segment todo" style="flex-grow: 5"></span>
                </span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"
                  ><span>9 Jira</span><span>1 done</span
                  ><span
                    class="overview-signal"
                    title="Oriel rule: A member in progress with no update in 14 days"
                    >2 in progress, no update in 14 days</span
                  ></span
                >
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
                  aria-label="3 done, 2 in progress, 7 to do"
                  title="3 done, 2 in progress, 7 to do"
                >
                  <span class="segment done" style="flex-grow: 3"></span>
                  <span class="segment in-progress" style="flex-grow: 2"></span>
                  <span class="segment todo" style="flex-grow: 7"></span>
                </span>
                <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
                <span class="overview-last" title="Latest member update or thread activity"
                  >today</span
                >
                <span class="overview-workstream-detail"
                  ><span>12 Jira</span><span>2 waiting on you</span
                  ><span
                    class="overview-signal"
                    title="Oriel rule: A member in progress with no update in 14 days"
                    >2 in progress, no update in 14 days</span
                  ></span
                >
              </li>
            </ul>
          </section>
        </div>
        <div class="overview-side">
          <section
            class="overview-section"
            data-section="candidates"
            aria-label="Not in a workstream yet"
          >
            <h2 class="overview-head">
              <span>Not in a workstream yet</span><span class="overview-count">16</span
              ><span class="overview-head-more"
                ><a class="overview-more" href="/browse?grouping=epic&amp;workstream=none"
                  >8 more</a
                ></span
              >
            </h2>
            <div class="overview-rows overview-candidates">
              <div class="overview-group">
                <p class="overview-rule">
                  <span class="derived-tag">Oriel rule</span> An epic no workstream holds
                </p>
                <ul>
                  <li class="overview-candidate" data-rule="An epic no workstream holds">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-4"
                      target="_blank"
                      rel="noopener noreferrer"
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
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-5"
                      target="_blank"
                      rel="noopener noreferrer"
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
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-66"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-66</span> Look up vehicle dimensions from the
                      registration</a
                    >
                    <span class="overview-sub">Jira · 14 days idle</span>
                  </li>
                  <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-93"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-93</span> Investigate slow search on the timetable
                      page</a
                    >
                    <span class="overview-sub">Jira · 17 days idle</span>
                  </li>
                  <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-20"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-20</span> Announce form errors on the vehicle step</a
                    >
                    <span class="overview-sub">Jira · 19 days idle</span>
                  </li>
                  <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-119"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-119</span> Vehicle step forgets the registration after
                      going back</a
                    >
                    <span class="overview-sub">Jira · 20 days idle</span>
                  </li>
                  <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-77"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-77</span> Support landscape orientation on phones</a
                    >
                    <span class="overview-sub">Jira · 22 days idle</span>
                  </li>
                  <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                    <a
                      class="overview-title"
                      href="https://ferrowick.atlassian.net/browse/SYN-46"
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span class="key">SYN-46</span> Move the staging database to the new
                      region</a
                    >
                    <span class="overview-sub">Jira · 23 days idle</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>
          <section
            class="overview-section"
            data-section="people"
            aria-label="In progress, by person"
          >
            <h2 class="overview-head">
              <span>In progress, by person</span><span class="overview-count">8</span>
            </h2>
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
              <li class="overview-row overview-person">
                <a
                  class="overview-title"
                  href="/browse?grouping=assignee&amp;assignee=esme&amp;status=in-progress"
                  >Esme Whitlock</a
                >
                <span class="overview-sub">3</span>
              </li>
              <li class="overview-row overview-person">
                <a
                  class="overview-title"
                  href="/browse?grouping=assignee&amp;assignee=bastian&amp;status=in-progress"
                  >Bastian Holm</a
                >
                <span class="overview-sub">2 · Boarding passes and gate scanning (1)</span>
              </li>
              <li class="overview-row overview-person">
                <a
                  class="overview-title"
                  href="/browse?grouping=assignee&amp;assignee=chen&amp;status=in-progress"
                  >Chen Yuting</a
                >
                <span class="overview-sub">2 · Weather disruptions and rebooking (1)</span>
              </li>
              <li class="overview-row overview-person">
                <a
                  class="overview-title"
                  href="/browse?grouping=assignee&amp;assignee=greta&amp;status=in-progress"
                  >Greta Lindqvist</a
                >
                <span class="overview-sub">1 · Saved cards launch (1)</span>
              </li>
              <li class="overview-row overview-person">
                <a
                  class="overview-title"
                  href="/browse?grouping=assignee&amp;assignee=hiro&amp;status=in-progress"
                  >Hiro Tanabe</a
                >
                <span class="overview-sub">1 · Boarding passes and gate scanning (1)</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
      <div class="chat-dock overview-dock">
        <form class="chat-input" data-elevation="raised">
          <textarea
            class="chat-input-field"
            rows="2"
            placeholder="Ask about your window"
            aria-label="Message"
          ></textarea>
          <div class="chat-input-foot">
            <span class="chat-input-reads">Reads your whole window</span>
            <button type="submit" class="button" disabled>Ask</button>
          </div>
        </form>
      </div>
    </main>
  </div>
</div>
```

## With the window chat

Asked, the window chat opens in a rail at the window's right edge, and the page column narrows for it, so the overview stays whole beside the chat rather than under it (`.shell[data-chat]`). The composer leaves the page's foot for the rail's (Motion A). The rail stays on Browse too: it's the same conversation, still watched. **Hide the chat**, the fold in its head, puts the composer back at the foot, with its draft, what it's looking at, and "Back to the chat". Under 1100px there's no rail: the chat is a sheet over the page's foot, 45vh, or 85vh with its grab bar. See [Right rail](/components/right-rail#the-window-chat-s-rail), [Layout](/foundations/layout) and [Motion](/foundations/motion#motion-a-the-composer-carried); the shots are `window-rail-browse` and `ask-back`.

When the person opens an item from it, a chip in an answer, the item takes the rail's place, as wide, so the overview keeps its width, and carries the chat in its dock, at every width. The chip stays marked ([Chip](/components/chip)), and the panel steps through the items that answer named ("1 of 2"). Chat in the dock folds the item to a line above the rail's composer; closing the item brings the rail back. The shots are `ask-panel-beside`, `ask-panel-step` and `ask-panel-window`.

When the chat moves into its workstream, as when the agent gathers items into it, the conversation stays in the rail, ending "Now a thread in" its workstream, and the composer is a fresh chat's at once. Open as a thread hands it over the same way and goes to the thread. The shots are `window-moved`, `window-moved-asked-again`, `window-moved-opened` and `window-moved-continued`.

## Built from

- [Sidebar](/components/sidebar): the shell, the head, search and New thread, Window, Needs you, Workstreams, Done, Sources and Settings; and at 390, the bar with its menu.
- [Tabs](/components/tabs): Overview and Browse.
- [Page head](/components/page-head): the top strip and its counts.
- [Chat input](/components/chat-input): the composer at the page's foot, and the questions to start from beside their headlines.
- [Right rail](/components/right-rail#the-window-chat-s-rail): the window chat's rail, once asked.
- [Button](/components/button): Ask, and Make a workstream.
- [Overview sections](/components/overview-section): the columns, each section's head and count, the headlines with the review links' one, and the page's one spacing rule.
- [List rows](/components/list-row): the workstream, candidate and person rows.
- [Meter](/components/meter): the status bars and the sparks.
- [State chip, status and counts](/components/badge): the state dots, what each thread waits on, and the counts.
- [Icon button](/components/icon-button): the fold button, New thread, the disclosures and the menu.
- [Tooltip](/components/tooltip): on the fold button and New thread.

## Notes for review

- **Two greys for "nothing".** The sidebar's workstream counts, the overview's "none moved", "today" and the people's subs are all quiet text, but in two different tokens: the sidebar's `.nav-count` is `--text-faint`, the rows' `.overview-quiet` and `.overview-sub` are `--text-muted`. Next to each other on this screen, "0" in the sidebar reads lighter than "No items" on the page.
- **A flat spark beside a status bar.** With nothing moved, every row draws a flat grey line and then a coloured bar. The spark says nothing here but takes the eye first; the app could leave it out when `data-quiet` is set, as it already does at 390.
- **Three kinds of "N more".** "3 more" in Needs you is a faint `.nav-more` button, "8 more" on Not in a workstream yet is an accent `.overview-more` link in the head, and Workstreams' would be an accent button under the list. Same words, three looks; see [Overview sections](/components/overview-section) and [Lab: more](/lab/more).
- **"Your turn" wears the in-progress colour.** In Needs you, "Your turn" and its dot are the same blue as the status bars' in-progress segments, while "Needs review" and "Message held" take the accent. All three are the person's move; only two look it. Broadsheet dark makes the split plainer (blue against amber). See [State chip, status and counts](/components/badge#drift).
- **An epic candidate never shows its sub.** "11 items · Jira · 2 changed this week" is in the markup, but `.overview-make` keeps its room while hidden (`opacity: 0`), and the title takes up to 60%, so the sub is squeezed to nothing at 1280 and to a stray sliver at 390. The reference shots show the same. Make a workstream itself only appears on hover or focus, between the epic rows in the tab order.
- **The fixture repeats itself.** The reference shots show four Needs you rows called "Plan gift cards" and two workstreams called "Boarding passes and gate scanning". This screen uses other threads from the same fixture, and six workstreams, so the rows read as different; the fixture's duplicates are worth fixing in Oriel's seed.
