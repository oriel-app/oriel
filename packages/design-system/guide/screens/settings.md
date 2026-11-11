---
title: Settings › Appearance
order: 40
summary: Settings open at Appearance, with its section list. Theme and Text size are the person's own choice, and change how every page looks, never what it says.
---

# Settings › Appearance

## What it shows

Settings, opened at Appearance from the sidebar's foot. Down the left are Settings' seven sections, each its own address, with Appearance current. The section has two choices: the theme (Graphite, the default, or Broadsheet) and the text size (Small, Default or Large). Each applies at once; there's no Save. These are the same two choices this workshop's own bar offers as Theme and Text size.

At 390 the sidebar becomes the bar with its menu, and the sections become a wrapping row of links above the choices.

```html specimen id=screen screen height=720 title="Settings › Appearance: Graphite, at the default size"
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
              <a href="/workstreams/checkout-v2" class="nav-link">
                <span class="nav-name">Checkout v2: phone wallets and saved cards</span>
                <span class="nav-count" title="17 items">17</span>
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
              aria-controls="nav-threads-gift"
            >
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4l4 4-4 4" />
              </svg>
              <span class="visually-hidden">Show threads in Gift cards</span>
            </button>
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
            <span class="nav-disclose" aria-hidden="true"></span>
            <div class="nav-workstream-menu">
              <a href="/workstreams/declined-card-retry" class="nav-link">
                <span class="nav-name">Declined card retry</span>
                <span class="nav-count" title="2 items">2</span>
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
      <a href="/settings" class="nav-link" aria-current="page">
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
        <span class="visually-hidden">Open the sidebar, 4 threads waiting on you</span>
        <span class="bar-count" aria-hidden="true">4</span>
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
      <h1 class="page-title">Settings</h1>
      <div class="settings">
        <nav class="settings-sections" aria-label="Settings">
          <a class="nav-link" href="/settings/providers">Providers</a>
          <a class="nav-link" href="/settings/usage">Usage</a>
          <a class="nav-link" href="/settings/connections">Connections</a>
          <a class="nav-link" href="/settings/general">General</a>
          <a class="nav-link" href="/settings/appearance" aria-current="page">Appearance</a>
          <a class="nav-link" href="/settings/asking">Asking</a>
          <a class="nav-link" href="/settings/notifications">Notifications</a>
        </nav>
        <div class="settings-body">
          <section class="settings-section" aria-labelledby="settings-appearance">
            <h2 id="settings-appearance" class="settings-title">Appearance</h2>
            <fieldset class="settings-field">
              <legend class="settings-field-name">Theme</legend>
              <div class="choices">
                <label class="choice"
                  ><input type="radio" name="settings-theme" value="graphite" checked />Graphite
                  (the default)</label
                >
                <label class="choice"
                  ><input type="radio" name="settings-theme" value="broadsheet" />Broadsheet</label
                >
              </div>
            </fieldset>
            <fieldset class="settings-field">
              <legend class="settings-field-name">Text size</legend>
              <div class="choices">
                <label class="choice"
                  ><input type="radio" name="settings-text-size" value="small" />Small</label
                >
                <label class="choice"
                  ><input
                    type="radio"
                    name="settings-text-size"
                    value="default"
                    checked
                  />Default</label
                >
                <label class="choice"
                  ><input type="radio" name="settings-text-size" value="large" />Large</label
                >
              </div>
            </fieldset>
          </section>
        </div>
      </div>
    </main>
  </div>
</div>
```

## Built from

- [Sidebar](/components/sidebar): the shell, the sidebar with Settings current at its foot, and the bar and drawer at 390. Settings' section list is the sidebar's `.nav-link` too.
- [Page head](/components/page-head): `main.page` and its `.page-title`, "Settings".
- [Connection and provider rows](/components/connection-row): the Settings frame, `.settings`, `.settings-sections`, `.settings-body`, `.settings-section` and `.settings-title`. The rows themselves are on Providers and Connections, not here.
- [Checkbox and radio](/components/checkbox-radio): each setting as a `fieldset.settings-field` of `label.choice` radios, which Oriel's `Choices` draws.
- [Tooltip](/components/tooltip): the fold button and New thread.

How a setting is laid out and saved is the [Forms](/patterns/forms) pattern.

## Notes for review

- The radios are the browser's own, tinted with `accent-color: var(--accent)` (`.choice input` in `window.css`). They're the one control on this screen that doesn't take Oriel's shape, and their focus ring is the browser's. Because they're the browser's, they follow `color-scheme: light dark` (`html` in `window.css`), not the workshop's forced dark: in this workshop's dark view an unchecked radio stays light, while in the app's dark it draws dark. The [controls lab](/lab/checkbox-radio) has a proposal; this screen shows today's.
- The Theme and Text size here are drawn checked at Graphite and Default whatever this workshop's bar is set to: a specimen has no script to read it. In the app the checked radio is the person's saved choice (`Appearance` in `packages/web/src/settings-page.tsx`).
- The section list is the sidebar's `.nav-link`, so the current section is raised exactly as the current sidebar row is. On this page both are raised at once: Settings in the sidebar's foot and Appearance in the list. That's consistent, but two raised rows side by side compete; worth a look.
- The app's page is `main.page.settings-page`; window.css has no rule for `.settings-page`, so the screen leaves it off, as the component pages do.
- Light or dark isn't a setting: it stays the system's choice (decision 0034). A review link's page always has the default look, whatever the person picked here (decision 0041).
