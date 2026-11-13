---
title: Overview sections
status: drifting
group: Layout
order: 74
classes: overview, overview-columns, overview-main, overview-side, overview-section, overview-head, overview-count, overview-head-more, overview-rows, overview-row, overview-title, overview-sub, overview-more, overview-headlines, overview-band, band-track, band-next, overview-headline, overview-headline-label, overview-headline-body, headline-asks, review-links, overview-changed, overview-quiet, overview-loading, overview-problem, first-run-line, key, section, section-head, section-title, quiet-action
summary: How the overview is laid out and headed: its one spacing rule, its two columns and their container queries, each section's head with its count and "N more", the list frame, the headlines with their questions to start from, and the notes. Section heads and list frames change with the theme.
---

# Overview sections

## What it is

The overview (decision 0027) is "the counts strip, then the headlines, each with its questions to start from (decision 0030) and the review links nobody has opened among them; then the workstreams, and beside them what no workstream holds yet and who has work in progress, their heads on one line. The composer is a thread's, at the page's foot." (`packages/web/src/overview-page.tsx`). This page is its frame: everything around the rows.

- **The page** (`main.overview`): a column that is also a container, `overview`, so its columns follow the page's own width, which the item panel narrows. Its composer is a thread's, in a `.chat-dock` at its foot (see [Chat input](/components/chat-input)).
- **One rhythm**: the page's parts are `--space-6` apart, a section's head is `--space-2` over its list, and every list row pads by `--row-pad`. Nothing on the overview sets a margin of its own.
- **The columns** (`.overview-columns`): one column, then `minmax(0,1.6fr) minmax(16rem,1fr)` once the overview is 760px wide (`@container overview (min-width: 760px)` in `window.css`), so at 1100 with the sidebar open the two heads still share a line. `.overview-main` holds Workstreams, then any pins; `.overview-side` holds Not in a workstream yet, then Noticed, then In progress, by person. Neither pushes the workstreams down.
- **A section** (`section.overview-section`): a head and a list. The head (`h2.overview-head`) is the title, its count (`.overview-count`) and, at its end, any "N more" (`.overview-head-more`). "The theme's rule above it gives the sections their rank, and its colour is muted in every theme." (`.overview-head` in `window.css`).
- **The list frame** (`.overview-rows`): `--list-frame` around it and `--list-bg` behind it. The rows inside are on [List rows](/components/list-row).
- **The headlines** (`.overview-headlines`): "The standing questions, one computed line each, with its rule on hover, and the questions to start from that each one offers at its row's end. The review links nobody has opened are the last." (`Headlines` in `packages/web/src/overview-page.tsx`).
- **"N more"** (`.overview-more`): an accent word, in two places (see Drift).
- **Notes**: what changed by workstream (`.overview-changed`), and the loading, problem and empty lines.

The top strip (tabs and counts) is on [Page head](/components/page-head), and the composer and the questions' buttons on [Chat input](/components/chat-input).

## When to use it

- Use `section.overview-section` with an `h2.overview-head` for each list on the overview, and nowhere else.
- Put the count in `.overview-count` when the list is capped: it says how many there are in all, not how many show.
- Put a new section in `.overview-main` if it's about the workstreams, and in `.overview-side` if it's about what's outside them.
- Use `.overview-headlines` only for computed lines, each with a rule a person can read.

## When not to

- Not on other pages. A section on a workstream, Done or thread page has a small-caps `h2.section-title` in a `section.section`, with a `.section-head` when an action sits beside it (below).
- Not a heading for a card or a box. The overview has no cards; see [List rows](/components/list-row).
- Don't hard-code a frame or a heading look. The section rule, the head's font and case, and the list's frame and background are theme tokens; a section that sets its own won't change with the theme.
- Don't write a headline the server didn't compute. Every number and line on the overview "is the server's, computed, never generated; each derived one shows its rule" (`packages/web/src/overview-page.tsx`).

## Anatomy and variants

### The whole overview

```html specimen id=layout title="The overview at 1280, without the sidebar: the top strip, the headlines, then two columns" screen height=800
<main class="overview" aria-busy="false">
  <div class="overview-top">
    <nav class="tabs view-tabs" aria-label="Window">
      <a href="/" aria-current="page">Overview</a>
      <a href="/browse">Browse</a>
    </nav>
    <p class="overview-counts" data-section="strip">
      <span class="overview-since">Since you looked Tue, Nov 3:</span>
      <button type="button" class="overview-stat" aria-expanded="false">
        <strong>12</strong> items changed
      </button>
      <span class="overview-stat"><strong>3</strong> workstreams moved</span>
      <button type="button" class="overview-stat" aria-controls="needs-you">
        <strong>2</strong> need you
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
    <p class="overview-headline" data-headline="moved">
      <span
        class="overview-headline-label"
        title="Oriel rule: The workstream with the most members changed since you last left the overview"
        >Moved most</span
      >
      <span class="overview-headline-body"
        ><a class="overview-title" href="/workstreams/ws-checkout"
          >Checkout v2: phone wallets and saved cards</a
        >
        <span class="overview-sub">4 items moved, 1 to done</span></span
      >
    </p>
    <p class="overview-headline" data-headline="quiet">
      <span
        class="overview-headline-label"
        title="Oriel rule: The open workstream whose latest member update or thread activity is oldest"
        >Quiet longest</span
      >
      <span class="overview-headline-body"
        ><a class="overview-title" href="/workstreams/ws-weather"
          >Weather disruptions and rebooking</a
        >
        <span class="overview-sub">nothing moved in 16 days</span></span
      >
    </p>
  </section>

  <div class="overview-columns">
    <div class="overview-main">
      <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
        <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">7</span></h2>
        <ul class="overview-rows">
          <li class="overview-row overview-workstream" data-workstream="ws-checkout">
            <a class="overview-title overview-workstream-name" href="/workstreams/ws-checkout"
              >Checkout v2: phone wallets and saved cards</a
            >
            <svg
              class="overview-spark"
              viewBox="0 0 56 17"
              role="img"
              aria-label="23 changes in the last 14 days"
            >
              <title>23 changes in the last 14 days</title>
              <polyline
                points="0,16 4.3,13.2 8.6,16 12.9,10.4 17.2,7.6 21.5,13.2 25.8,16 30.2,16 34.5,4.8 38.8,10.4 43.1,13.2 47.4,7.6 51.7,2 56,13.2"
              />
            </svg>
            <span
              class="status-bar"
              role="img"
              aria-label="5 done, 4 in progress, 5 to do"
              title="5 done, 4 in progress, 5 to do"
            >
              <span class="segment done" style="flex-grow: 5"></span>
              <span class="segment in-progress" style="flex-grow: 4"></span>
              <span class="segment todo" style="flex-grow: 5"></span>
            </span>
            <span class="overview-moved"><strong>4</strong> moved, 1 done</span>
            <span class="overview-last" title="Latest member update or thread activity">today</span>
            <span class="overview-workstream-detail"
              ><span>15 Jira</span><span>2 waiting on you · 1 working · 3 done</span></span
            >
          </li>
          <li class="overview-row overview-workstream" data-workstream="ws-saved">
            <a class="overview-title overview-workstream-name" href="/workstreams/ws-saved"
              >Saved cards launch</a
            >
            <svg
              class="overview-spark"
              viewBox="0 0 56 17"
              role="img"
              aria-label="4 changes in the last 14 days"
            >
              <title>4 changes in the last 14 days</title>
              <polyline
                points="0,16 4.3,16 8.6,9 12.9,16 17.2,16 21.5,16 25.8,2 30.2,16 34.5,16 38.8,9 43.1,16 47.4,16 51.7,16 56,16"
              />
            </svg>
            <span
              class="status-bar"
              role="img"
              aria-label="2 done, 1 in progress, 3 to do"
              title="2 done, 1 in progress, 3 to do"
            >
              <span class="segment done" style="flex-grow: 2"></span>
              <span class="segment in-progress" style="flex-grow: 1"></span>
              <span class="segment todo" style="flex-grow: 3"></span>
            </span>
            <span class="overview-moved"><strong>1</strong> moved</span>
            <span class="overview-last" title="Latest member update or thread activity"
              >2d ago</span
            >
            <span class="overview-workstream-detail"
              ><span>3 Folder · 3 Jira</span><span>1 waiting on you</span></span
            >
          </li>
        </ul>
        <button type="button" class="overview-more">5 more</button>
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
              >12 more</a
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
                <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-4"
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
            </ul>
          </div>
          <div class="overview-group">
            <p class="overview-rule">
              <span class="derived-tag">Oriel rule</span> In progress, no update in 14 days
            </p>
            <ul>
              <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-20"
                  ><span class="key">SYN-20</span> Announce form errors on the vehicle step</a
                >
                <span class="overview-sub">Jira · 19 days idle</span>
              </li>
              <li class="overview-candidate" data-rule="In progress, no update in 14 days">
                <a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-46"
                  ><span class="key">SYN-46</span> Move the staging database to the new region</a
                >
                <span class="overview-sub">Jira · 23 days idle</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
      <section class="overview-section" data-section="people" aria-label="In progress, by person">
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
        </ul>
      </section>
    </div>
  </div>
</main>
```

- `main.overview` is a column with `--space-6` between its parts, padded `--inset-top` and `--space-6` (`--space-3` under 760px), at least as tall as the window, so its composer's dock sits at the foot however short the page. The dock's own padding is the room under the last row.
- `.overview-main` and `.overview-side` are grids with `--space-6` between sections. In the app the overview sits in `.shell-main` beside the [sidebar](/components/sidebar); pins, when there are any, go under Workstreams, and Noticed under Not in a workstream yet.
- The composer and the counts strip belong to [Chat input](/components/chat-input) and [Page head](/components/page-head). The specimen leaves the composer out.

### Narrow: one column

The columns key off the `overview` container, not the screen: below 760px of overview the side column goes under the main one. That happens on a laptop with the item panel open, as well as on a phone. A main column under 560px (`@container main`) gives each workstream's name the row's first line, with its spark, bar, what moved and when under it; on a phone the spark goes too. On a phone the headlines are one row of cells that scrolls sideways, each with its questions under it.

```html specimen id=narrow title="At 390: one column, the side's sections under the main's" width=390
<main class="overview" aria-busy="false">
  <div class="overview-columns">
    <div class="overview-main">
      <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
        <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">7</span></h2>
        <ul class="overview-rows">
          <li class="overview-row overview-workstream" data-workstream="ws-gift">
            <a class="overview-title overview-workstream-name" href="/workstreams/ws-gift"
              >Gift cards</a
            >
            <span class="status-bar empty"></span>
            <span class="overview-moved"><span class="overview-quiet">none moved</span></span>
            <span class="overview-last" title="Latest member update or thread activity">today</span>
            <span class="overview-workstream-detail"><span>No items</span></span>
          </li>
        </ul>
        <button type="button" class="overview-more">6 more</button>
      </section>
    </div>
    <div class="overview-side">
      <section class="overview-section" data-section="people" aria-label="In progress, by person">
        <h2 class="overview-head">
          <span>In progress, by person</span><span class="overview-count">12</span
          ><span class="overview-head-more"
            ><a class="overview-more" href="/browse?grouping=assignee&amp;status=in-progress"
              >2 more</a
            ></span
          >
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
        </ul>
      </section>
    </div>
  </div>
</main>
```

### A section's head

```html specimen id=head title="Section heads: title and count; and with N more at the end"
<div class="ws-stack">
  <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
    <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">7</span></h2>
  </section>
  <section class="overview-section" data-section="candidates" aria-label="Not in a workstream yet">
    <h2 class="overview-head">
      <span>Not in a workstream yet</span><span class="overview-count">16</span
      ><span class="overview-head-more"
        ><a class="overview-more" href="/browse?grouping=epic&amp;workstream=none">8 more</a></span
      >
    </h2>
  </section>
</div>
```

The head takes everything from the theme:

| Token                     | Graphite                                              | Broadsheet                                                                              |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `--section-rule`          | a thin `--line-strong` rule (`:root` in `window.css`) | a thick rule in `--text` (`:root[data-theme="broadsheet"]` in `window.css`)             |
| `--section-head-font`     | strong, `--text-sm`                                   | strong, `--text-lg`, tight leading                                                      |
| `--section-head-case`     | uppercase                                             | none                                                                                    |
| `--section-head-tracking` | 0.04em                                                | 0                                                                                       |
| `--list-frame`            | a thin `--line` border (`:root` in `window.css`)      | none: the list lies open on the page (`:root[data-theme="broadsheet"]` in `window.css`) |
| `--list-bg`               | `--surface` (`:root` in `window.css`)                 | `--bg` (`:root[data-theme="broadsheet"]` in `window.css`)                               |
| `--row`, `--row-pad`      | 2rem, 0.375rem                                        | 2.25rem, 0.5rem                                                                         |

Flip the theme in the workshop's bar to see the same markup become a ruled, open list. The head's colour is `--text-muted` in every theme, and its count `--text-faint`. `.overview-head-more` undoes the case and tracking, so "8 more" reads as a word, not a label.

### The headlines

```html specimen id=headlines title="Headlines: one computed line each, its rule in the label's title"
<section class="overview-headlines" data-section="headlines" aria-label="Headlines">
  <p class="overview-headline" data-headline="moved">
    <span
      class="overview-headline-label"
      title="Oriel rule: The workstream with the most members changed since you last left the overview"
      >Moved most</span
    >
    <span class="overview-headline-body"
      ><a class="overview-title" href="/workstreams/ws-checkout"
        >Checkout v2: phone wallets and saved cards</a
      >
      <span class="overview-sub">4 items moved, 1 to done</span></span
    >
  </p>
  <p class="overview-headline" data-headline="quiet">
    <span
      class="overview-headline-label"
      title="Oriel rule: The open workstream whose latest member update or thread activity is oldest"
      >Quiet longest</span
    >
    <span class="overview-headline-body"
      ><a class="overview-title" href="/workstreams/ws-weather"
        >Weather disruptions and rebooking</a
      >
      <span class="overview-sub">nothing moved in 16 days</span></span
    >
  </p>
  <p class="overview-headline" data-headline="talked">
    <span
      class="overview-headline-label"
      title="Oriel rule: The item chat messages from the last 7 days name most"
      >Named most in chat this week</span
    >
    <span class="overview-headline-body"
      ><a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-23"
        ><span class="key">SYN-23</span> Pay with a phone wallet on the website</a
      >
      <span class="overview-sub"
        >named 5× · in Checkout v2: phone wallets and saved cards</span
      ></span
    >
  </p>
  <p class="overview-headline" data-headline="top">
    <span class="overview-headline-label" title="Oriel rule: An epic no workstream holds"
      >Top not in a workstream</span
    >
    <span class="overview-headline-body"
      ><a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-4"
        ><span class="key">SYN-4</span> Vehicle and freight reservations</a
      >
      <span class="overview-sub">Jira · 2 changed this week</span></span
    >
  </p>
</section>
```

- Up to four, each only when it has an answer: "Moved most" (the counts strip says since when), "Quiet longest", "Named most in chat this week", "Top not in a workstream" (`headlines` in `packages/server/src/overview.ts`).
- It wears the list frame. Without questions to start from, the overview draws it as a band, below; `.overview-headlines` alone is an auto-fit grid of `minmax(10rem, 1fr)`: "Fit, not fill: one headline takes the whole row, not a third of it." (`.overview-headlines` in `window.css`).
- **Without questions, one band that never wraps** (`Band` in `packages/web/src/overview-page.tsx`): `div.overview-band` around `section.overview-headlines.band-track`. Each cell is `flex: 1 0 10rem`, so they share the width where all fit. Where they don't, the track scrolls sideways, snapping a headline at a time. While there's more to the right (`.overview-band[data-more]`, measured on scroll and on resize), its end fades (a mask) under a round **›** (`button.band-next`, "More headlines", in a tooltip), which scrolls to the first headline cut off. The track ends with room for both, so the last headline scrolls clear and the fade and › go. A phone has no ›: it swipes, and the narrow rules below take over.
- With questions to start from (`[data-questions]`), each headline is a row, one a line: the labels share a column as wide as the longest (a subgrid), and the row's questions (`.headline-asks`) sit at its end, each in its short form, which names nothing the headline names ("Why is it stalled?"), so it never squeezes the line. Each question's button names itself with its visible words and is described by its headline's line (`aria-describedby`). Once a chat has started, open or hidden, the overview has no questions, and draws the band. Under a 700px overview a row is its label over its line, with its questions stacked beside both.

```html specimen id=headlines-band title="Without questions: the band, with more to the right"
<div style="max-width: 36rem">
  <div class="overview-band" data-more>
    <section class="overview-headlines band-track" data-section="headlines" aria-label="Headlines">
      <p class="overview-headline" data-headline="moved">
        <span
          class="overview-headline-label"
          title="Oriel rule: The workstream with the most members changed since you last left the overview"
          >Moved most</span
        >
        <span class="overview-headline-body"
          ><a class="overview-title" href="/workstreams/ws-checkout"
            >Checkout v2: phone wallets and saved cards</a
          >
          <span class="overview-sub">4 items moved, 1 to done</span></span
        >
      </p>
      <p class="overview-headline" data-headline="quiet">
        <span
          class="overview-headline-label"
          title="Oriel rule: The open workstream whose latest member update or thread activity is oldest"
          >Quiet longest</span
        >
        <span class="overview-headline-body"
          ><a class="overview-title" href="/workstreams/ws-weather"
            >Weather disruptions and rebooking</a
          >
          <span class="overview-sub">nothing moved in 16 days</span></span
        >
      </p>
      <p class="overview-headline" data-headline="top">
        <span class="overview-headline-label" title="Oriel rule: An epic no workstream holds"
          >Top not in a workstream</span
        >
        <span class="overview-headline-body"
          ><a class="overview-title" href="https://ferrowick.atlassian.net/browse/SYN-4"
            ><span class="key">SYN-4</span> Vehicle and freight reservations</a
          >
          <span class="overview-sub">Jira · 2 changed this week</span></span
        >
      </p>
    </section>
    <button type="button" class="band-next" aria-label="More headlines">
      <span aria-hidden="true">›</span>
    </button>
  </div>
</div>
```

- The last is the review links sent and not opened (`data-headline="unopened"`, `.review-links`): the oldest one's thread, and "N more" opening the rest in place, each its own link. Their threads wait on others, so they aren't in Needs you.
- The label is `--text-xs`, uppercase and faint, with `cursor: help` and "Oriel rule: …" as its title. The body is one line, ellipsised; under 760px it wraps.
- An item headline opens the item in the [item panel](/components/item-panel); with no title it reads "Not in the window".

### "N more", in place and into Browse

```html specimen id=more title="N more: under a list it opens the rest in place; in a head it opens Browse"
<div class="ws-stack">
  <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
    <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">14</span></h2>
    <ul class="overview-rows">
      <li class="overview-row">
        <a class="overview-title" href="/workstreams/ws-boarding"
          >Boarding passes and gate scanning</a
        >
        <span class="overview-sub">9 Jira</span>
      </li>
    </ul>
    <button type="button" class="overview-more">6 more</button>
  </section>
  <section class="overview-section" data-section="people" aria-label="In progress, by person">
    <h2 class="overview-head">
      <span>In progress, by person</span><span class="overview-count">12</span
      ><span class="overview-head-more"
        ><a class="overview-more" href="/browse?grouping=assignee&amp;status=in-progress"
          >2 more</a
        ></span
      >
    </h2>
  </section>
</div>
```

Decision 0027 says: 'N more' opens the rest of a short list in place (Needs you, the workstreams). Only an item list's 'N more' opens Browse, "filtered to that slice, at its own address, since Browse has no view of threads or workstreams." So:

- **In place**: a `button.overview-more` after the list (Workstreams). Opened, every row shows and the button goes. Workstreams shows the first 8 and up to 4 gone quiet from beyond them (`shown` in `packages/web/src/overview.ts`).
- **Into Browse**: an `a.overview-more` in the head's `.overview-head-more` (Not in a workstream yet, In progress, by person), to Browse filtered to what the section counts.

### What changed, by workstream

```html specimen id=notes title="What changed, by workstream"
<div class="ws-stack">
  <section class="overview-changed" aria-label="What changed, by workstream">
    <ul class="overview-rows">
      <li class="overview-row">
        <a class="overview-title" href="/workstreams/ws-checkout"
          >Checkout v2: phone wallets and saved cards</a
        >
        <span class="overview-sub">4 items moved</span>
      </li>
      <li class="overview-row">
        <a class="overview-title" href="/workstreams/ws-saved">Saved cards launch</a>
        <span class="overview-sub">1 item moved</span>
      </li>
      <li class="overview-row">
        <span class="overview-title">Not in a workstream</span>
        <span class="overview-sub">7 items changed</span>
      </li>
    </ul>
  </section>
</div>
```

- **What changed, by workstream** (`.overview-changed`) opens from the counts strip's first count, under the top strip, at most 40rem wide. It lists 8 workstreams, then "and {N} more workstreams, below", then "Not in a workstream" with its count.

### The first run's line

```html specimen id=first-run title="The first run's one-time line, above the headlines"
<aside class="first-run-line" aria-label="About the window">
  <p>
    <strong>This is your window:</strong> your Jira issues in one place. To follow an epic, make it
    a <strong>workstream</strong>: Oriel keeps its items, your questions and its changes together.
    Start with the first question below.
  </p>
  <button type="button" class="quiet-action">Dismiss</button>
</aside>
```

"What the window and a workstream are, until it's dismissed or the first workstream is made." (`FirstRunLine` in `packages/web/src/overview-page.tsx`). It's the overview's only filled box: `--accent-soft`, `--radius-lg`.

### Sections on other pages

```html specimen id=section-title title="A section on a workstream page: small caps, with its action beside it"
<section class="section">
  <div class="section-head">
    <h2 class="section-title">Items</h2>
    <button type="button" class="quiet-action">Add from the window</button>
  </div>
  <ul class="members">
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
    </li>
  </ul>
</section>
```

`section.section` is `--space-6` from what's above; `.section-title` is `--text-xs`, strong, uppercase and faint in every theme (`.section-title` in `window.css`), shared with `.rail-title`. `.section-head` puts an action at the title's end. The workstream page's Threads and Items and the Done page's Workstreams and Threads use it.

## States

```html specimen id=state-focus title="Focus visible on N more, a headline and a row" state=focus-visible
<div class="ws-stack">
  <button type="button" class="overview-more ws-focus-visible">6 more</button>
  <section class="overview-headlines" aria-label="Headlines">
    <p class="overview-headline" data-headline="quiet">
      <span
        class="overview-headline-label"
        title="Oriel rule: The open workstream whose latest member update or thread activity is oldest"
        >Quiet longest</span
      >
      <span class="overview-headline-body"
        ><a class="overview-title ws-focus-visible" href="/workstreams/ws-weather"
          >Weather disruptions and rebooking</a
        >
        <span class="overview-sub">nothing moved in 16 days</span></span
      >
    </p>
  </section>
</div>
```

```html specimen id=state-hover title="Hover: titles turn accent; N more doesn't change" state=hover
<div class="ws-stack">
  <button type="button" class="overview-more ws-hover">6 more</button>
  <ul class="overview-rows">
    <li class="overview-row">
      <a class="overview-title ws-hover" href="/workstreams/ws-checkout"
        >Checkout v2: phone wallets and saved cards</a
      >
      <span class="overview-sub">4 items moved</span>
    </li>
  </ul>
</div>
```

```html specimen id=state-loading title="Loading, and a problem, in place of the columns" state=busy
<div class="ws-stack">
  <p class="overview-loading">Loading the overview…</p>
  <p class="overview-problem" role="alert">
    Oriel couldn't load the overview. <button type="button" class="quiet-action">Try again</button>
  </p>
</div>
```

```html specimen id=state-empty title="Empty sections keep their heads" state=empty
<div class="ws-stack">
  <section class="overview-section" data-section="workstreams" aria-label="Workstreams">
    <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">0</span></h2>
    <p class="overview-quiet">
      No workstreams yet. Make one from what isn't in a workstream yet, or from
      <a href="/browse">Browse</a>.
    </p>
  </section>
  <section class="overview-section" data-section="people" aria-label="In progress, by person">
    <h2 class="overview-head">
      <span>In progress, by person</span><span class="overview-count">0</span>
    </h2>
    <p class="overview-quiet">Nobody has work in progress.</p>
  </section>
</div>
```

- **Rest, hover, focus-visible**: titles (`a.overview-title`, `button.overview-title`) turn `--accent` on hover. `.overview-more` has no hover look; it's accent already. Focus is the global ring on every link and button.
- **Active** and **disabled** don't apply to a section; "N more" is never disabled, it isn't drawn when nothing is hidden.
- **Loading**: until the server answers, "Loading the overview…" stands where the columns go, and `main.overview` has `aria-busy="true"`. The top strip waits for the same answer.
- **Error**: the server's problem, then a `quiet-action` Try again, as `role="alert"` (`OverviewPage` in `packages/web/src/overview-page.tsx`). The sentence in the specimen is illustrative; the app shows what the server said.
- **Empty**: a section always draws its head and count; its list gives way to an `.overview-quiet` line saying why: "No workstreams yet. Make one from what isn't in a workstream yet, or from Browse.", "Every item a rule finds is in a workstream.", "Nobody has work in progress." The headlines draw nothing at all when they have nothing.

## Keyboard and ARIA

- Each section is a `section` with an `aria-label` that repeats its title ("Workstreams", "Not in a workstream yet", "In progress, by person"), so it's a named region; its head is a real `h2`. The headlines are a `section` labelled "Headlines" with no visible heading.
- The overview has no `h1`. The tabs are its first landmark (see [Page head](/components/page-head)).
- The `.overview-count` is read as part of the heading: "Workstreams 7".
- "N more" is a `button` when it opens in place and a link when it goes to Browse; after the in-place one, focus stays where it was and the new rows follow in the tab order.
- A headline's rule is only in its label's `title`, which a keyboard and a touch screen can't reach (see Drift).
- The second count in the top strip points at the sidebar's Needs you with `aria-controls="needs-you"`; that's on [Page head](/components/page-head).

## Content

- Section titles are sentence case and say what's in the list: **Workstreams**, **Not in a workstream yet**, **In progress, by person**. The theme decides whether they show in capitals; write them in sentence case.
- The count is the whole list's number, never "N of M".
- "N more" is the number and the word: "6 more", never "Show more" or "See all".
- Headline labels are questions answered: "Moved most", "Quiet longest", "Named most in chat this week", "Top not in a workstream". Details are lower case: "4 items moved, 1 to done", "nothing moved in 16 days", "named 5× · in Checkout v2: phone wallets and saved cards".
- The review links' headline: "2 review links not opened", then the oldest one's thread title and "1 more".
- Rules start "Oriel rule: " in a title, then the rule in sentence case.

## Where the app uses it

- The page and its columns: `OverviewPage` in `packages/web/src/overview-page.tsx`. CSS `.overview`, `.overview-columns`, `@container overview (min-width: 760px)`, `.overview-main` and `@container main (max-width: 560px)` in `window.css`.
- Section and head: `Section` in `packages/web/src/overview-page.tsx`. CSS `.overview-section`, `.overview-head`, `.overview-count` and `.overview-head-more` in `window.css`. Theme tokens, Graphite then Broadsheet: `:root` and `:root[data-theme="broadsheet"]` in `window.css`.
- The list frame: `.overview-rows` in `window.css`.
- "N more": in place `More` in `packages/web/src/overview-page.tsx`; into Browse `Candidates` and `People` in `packages/web/src/overview-page.tsx`. CSS `.overview-more` in `window.css`.
- Headlines: `Headlines`, `Band`, `Headline` and `Unopened` in `packages/web/src/overview-page.tsx`; computed by `headlines` in `packages/server/src/overview.ts`; their questions by `questionsFrom` in `packages/web/src/window-chat.ts`. CSS `.overview-headlines`, `.overview-band`, `.band-track`, `.overview-band[data-more] .band-track`, `.band-next`, `.overview-headline`, `.overview-headline-label`, `.overview-headline-body`, `.headline-asks` and `.review-links` in `window.css`.
- Notes: what changed `Changed` in `packages/web/src/overview-page.tsx`, CSS `.overview-sub` and `.overview-changed .overview-rows` in `window.css`. The first run's line `FirstRunLine` in `packages/web/src/overview-page.tsx`, CSS `.first-run-line` in `window.css`.
- Loading, problem and empty: `OverviewPage` in `packages/web/src/overview-page.tsx`; CSS `.overview-loading`, `.overview-problem` and `.overview-quiet` in `window.css`.
- Narrow: `@media (max-width: 760px)` in `window.css` (padding, the counts, the headlines' sideways row, the workstream rows, wrapping titles).
- Other pages' sections: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`, `DonePage` in `packages/web/src/other-pages.tsx`; CSS `.section`, `.section-head` and `.section-title` in `window.css`.

## Drift

Status **drifting**:

- **Two "N more"s on one page.** Workstreams' is a button under the list; the side's are links in the head. Decision 0027 explains why they go to different places, but not why they sit in different places. Browse's "Show 50 more" and the sidebar's "N more" are two more versions; see [List rows](/components/list-row) and [Sidebar](/components/sidebar).
- **Two section heads.** The overview's `.overview-head` follows the theme; every other page's `.section-title` is small caps in every theme. In Broadsheet the overview's heads are large, ruled and in sentence case, while a workstream page's are still `--text-xs` capitals.
- **Lists that ignore the frame tokens.** `.overview-rows` and `.overview-headlines` follow `--list-frame` and `--list-bg`; `.members` and `.clusters` on other pages don't ([rfc:R1](/drift)).
- **`.overview-quiet` is two things**: the empty line here, and the inline "none moved" in a workstream row, where its `--text-md` is a step too big (`.overview-quiet` in `window.css`).
- **Rules only on hover.** A headline's and a signal's rule live in `title`, so the keyboard and touch can't read them, though "each derived one shows its rule".

Which to copy until they're settled:

- A list on the overview: `section.overview-section > h2.overview-head` with `.overview-count`, then `ul.overview-rows`. Never set a frame, background or head font of your own.
- "N more" for a short list: the in-place `button.overview-more` after the list. Use the head-placed link only when the rest are on another page.
- A section anywhere else: `section.section > h2.section-title`, with `.section-head` if it has an action.
