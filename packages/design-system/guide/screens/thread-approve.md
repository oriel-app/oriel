---
title: A change set waiting for Approve
order: 20
summary: A thread at Oriel's most important moment. The agent has proposed three estimates, and nothing is written to Jira until the person approves them.
---

# A change set waiting for Approve

## What it shows

A thread in the Checkout v2 workstream. The person asked which stories still need estimates. The agent ran a script and proposed 3 points for each of three stories. The change set is waiting under its reply, with Approve and apply, Reject and Share review link. The sidebar lists the thread under Needs you, the right rail lists the thread's 17 items, and the composer waits at the foot.

At 390 the sidebar becomes the bar with its menu, which counts the 4 threads waiting on the person. The rail moves under the chat, and its rows become keys.

```html specimen id=screen screen height=780 title="Which stories here still need estimates? (Needs review)"
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
                <span class="nav-count" title="17 items">17</span>
              </a>
            </div>
          </div>
          <ul id="nav-threads-checkout" class="nav-threads">
            <li>
              <a href="/threads/estimates" class="nav-link nav-thread" aria-current="page">
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
              <a href="/threads/built-stories" class="nav-link nav-thread">
                <span
                  class="state-dot"
                  data-state="working"
                  data-waiting="review"
                  title="Needs review"
                ></span>
                <span class="nav-name">Mark the built stories done</span>
              </a>
            </li>
            <li>
              <a href="/threads/weather" class="nav-link nav-thread">
                <span class="state-dot" data-state="done" title="Done"></span>
                <span class="nav-name">Find anything about weather</span>
              </a>
            </li>
          </ul>
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
    <div class="thread-layout">
      <main class="thread" aria-busy="false">
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
          <li>
            <details class="run" data-outcome="ok">
              <summary>Ran a script · 1 read · 3 changes · 174 ms</summary>
              <div class="run-body">
                <pre class="code">
const stories = await jira.search({ epic: "SYN-1", estimate: null });
for (const story of stories) await jira.update(story.key, { points: 3 });</pre>
              </div>
            </details>
          </li>
          <li class="reply">
            <p>
              If any needed one, the proposed change is below. Nothing is written until you approve
              it.
            </p>
          </li>
          <li>
            <section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
              <header class="change-set-head">
                <h2>Proposed change</h2>
                <span class="change-set-status" role="status">Awaiting review</span>
              </header>
              <ul class="diff">
                <li class="diff-line" data-kind="update">
                  <p class="line-head">
                    <span class="sentence"
                      >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
                      <a
                        class="key source-link"
                        href="https://synthetic.atlassian.net/browse/SYN-23"
                        target="_blank"
                        rel="noopener noreferrer"
                        >SYN-23</a
                      ></span
                    >
                  </p>
                  <dl class="fields">
                    <div class="field">
                      <dt>Estimate</dt>
                      <dd class="edited">
                        <div class="side" data-side="after">
                          <span class="side-sign" aria-hidden="true">+</span
                          ><span class="side-text"
                            ><span class="visually-hidden">After: </span>3 points</span
                          >
                        </div>
                      </dd>
                    </div>
                  </dl>
                </li>
                <li class="diff-line" data-kind="update">
                  <p class="line-head">
                    <span class="sentence"
                      >Estimate “Save a card for next time” (SYN-99) at 3 points.
                      <a
                        class="key source-link"
                        href="https://synthetic.atlassian.net/browse/SYN-99"
                        target="_blank"
                        rel="noopener noreferrer"
                        >SYN-99</a
                      ></span
                    >
                  </p>
                  <dl class="fields">
                    <div class="field">
                      <dt>Estimate</dt>
                      <dd class="edited">
                        <div class="side" data-side="after">
                          <span class="side-sign" aria-hidden="true">+</span
                          ><span class="side-text"
                            ><span class="visually-hidden">After: </span>3 points</span
                          >
                        </div>
                      </dd>
                    </div>
                  </dl>
                </li>
                <li class="diff-line" data-kind="update">
                  <p class="line-head">
                    <span class="sentence"
                      >Estimate “Handle 3-D Secure challenges in the native checkout” (SYN-104) at 3
                      points.
                      <a
                        class="key source-link"
                        href="https://synthetic.atlassian.net/browse/SYN-104"
                        target="_blank"
                        rel="noopener noreferrer"
                        >SYN-104</a
                      ></span
                    >
                  </p>
                  <dl class="fields">
                    <div class="field">
                      <dt>Estimate</dt>
                      <dd class="edited">
                        <div class="side" data-side="after">
                          <span class="side-sign" aria-hidden="true">+</span
                          ><span class="side-text"
                            ><span class="visually-hidden">After: </span>3 points</span
                          >
                        </div>
                      </dd>
                    </div>
                  </dl>
                </li>
              </ul>
              <footer class="change-set-actions">
                <button type="button" class="button primary">Approve and apply</button>
                <button type="button" class="button">Reject</button>
                <button type="button" class="quiet-action">Share review link</button>
              </footer>
            </section>
          </li>
        </ol>
        <form class="composer">
          <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
          <button type="submit" class="button primary" disabled>Send</button>
        </form>
      </main>
      <aside class="rail" aria-label="This thread's items">
        <h2 class="rail-title">17 items · v3</h2>
        <ul class="members compact">
          <li class="member">
            <span class="type" data-type="epic" title="Epic"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-1"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-1</a
            ><span class="member-title">Checkout v2: phone wallets and saved cards</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="epic" title="Epic"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-3"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-3</a
            ><span class="member-title">Weather disruptions and rebooking</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="task" title="Task"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-10"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-10</a
            ><span class="member-title">Remove the legacy web-view checkout</span
            ><span class="status" data-category="todo">To Do</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-21"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-21</a
            ><span class="member-title">Update the payment declined error message</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-23"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-23</a
            ><span class="member-title">Pay with a phone wallet on the website</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-41"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-41</a
            ><span class="member-title">Receipt email: include the vehicle registration</span
            ><span class="status" data-category="done">Done</span>
          </li>
          <li class="member">
            <span class="type" data-type="task" title="Task"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-57"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-57</a
            ><span class="member-title">Checkout analytics: drop-off by step</span
            ><span class="status" data-category="todo">To Do</span>
          </li>
          <li class="member">
            <span class="type" data-type="bug" title="Bug"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-74"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-74</a
            ><span class="member-title">Card form loses focus after autofill</span
            ><span class="status" data-category="done">Done</span>
          </li>
          <li class="member">
            <span class="type" data-type="bug" title="Bug"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-86"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-86</a
            ><span class="member-title">Currency shown twice on the payment button</span
            ><span class="status" data-category="done">Done</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-87"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-87</a
            ><span class="member-title">Pay with a phone wallet</span
            ><span class="status" data-category="done">Done</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-92"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-92</a
            ><span class="member-title">Show the fare breakdown before payment</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-98"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-98</a
            ><span class="member-title">Apply promo codes at checkout</span
            ><span class="status" data-category="todo">To Do</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-99"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-99</a
            ><span class="member-title">Save a card for next time</span
            ><span class="status" data-category="todo">To Do</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-104"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-104</a
            ><span class="member-title">Handle 3-D Secure challenges in the native checkout</span
            ><span class="status" data-category="in-progress">In Progress</span>
          </li>
          <li class="member">
            <span class="type" data-type="story" title="Story"></span
            ><a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-111"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-111</a
            ><span class="member-title">Retry a payment without losing the selected seats</span
            ><span class="status" data-category="done">Done</span>
          </li>
          <li class="member gone">
            <span class="type" data-type=""></span
            ><button type="button" class="key source-link item-link">SYN-900</button
            ><span class="member-title">Not in the index</span>
          </li>
          <li class="member gone">
            <span class="type" data-type=""></span
            ><button type="button" class="key source-link item-link">SYN-901</button
            ><span class="member-title">Not in the index</span>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</div>
```

## Built from

- [Sidebar](/components/sidebar): the shell, the sidebar with this thread under Needs you and marked current under its workstream, and the bar and drawer at 390.
- [Page head](/components/page-head): the thread head, its crumb, serif title and Mark done.
- [Badge](/components/badge): the "Needs review" state chip, and the sidebar's state dots and counts.
- [Message](/components/message): the person's message, the agent's replies and the run line.
- [Change set](/components/change-set): Proposed change, Awaiting review, three estimate lines and their steps.
- [Button](/components/button): Approve and apply (the one primary), Reject, and the quiet Mark done and Share review link.
- [Chat input](/components/chat-input): the composer at the foot, with Send off until something is written.
- [Right rail](/components/right-rail): 17 items · v3, a type mark, key and title for each, and two items no longer in the index.
- [Tooltip](/components/tooltip): the fold button and New thread.

The moment itself is the [Approval](/patterns/approval) pattern.

## Notes for review

- The change set has no `.change-set-count` while it's open. The app writes "3 changes" only on a folded one (`ChangeSet` in `packages/web/src/thread-page.tsx`). Here the run's summary carries the count instead: "3 changes".
- Approve and apply is the only primary button in sight while the composer is empty: Send is the primary too, but stays disabled until something is written. Once the person types, two primaries sit on one screen. Worth deciding whether Send should step down while a change set waits.
- The app wraps the change set and the run in `li.change-set-block` and `li.run-block` (`ChatEntryItem` in `packages/web/src/thread-page.tsx`). Those classes have no rules in window.css, so the screen leaves them off, as the component pages do.
- The keys in the diff and the rail are links that open Jira in a new tab, and Oriel opens the item panel on a plain click (`ItemKey` in `packages/web/src/parts.tsx`). Nothing in the markup tells a keyboard or screen reader user which one Enter does. The two not in the index are buttons, with no href to fall back on.
- Each estimate line repeats what its sentence already says ("at 3 points", then "Estimate + 3 points"). That's the diff's shape for every edit, so it stays; a field that had a value would show it on a − line above the + line.
- At 390 the rail moves below the composer, as a wrapping line of type marks and keys with the titles hidden (`@container page (max-width: 932px)` in `window.css`). The person loses the rail's titles on a phone, where the item panel is the only way to read one.
