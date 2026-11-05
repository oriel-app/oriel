---
title: Long lists
order: 30
summary: Avoid a long list before scrolling it. Show the top few with "N more", page in place with "Show 50 more", and search before reaching for a virtual list. Never infinite scroll.
---

# Long lists

## The problem

A window holds thousands of items, and a person's threads and workstreams pile up. A list that shows everything is slow to draw and slow to read: the thing someone needs is past the fold, and a scrolling page never says how much is left. A virtual list hides the cost but not the problem, and it's one more dependency.

## The pattern

Decision 0027: **"Long lists are avoided before they are scrolled."**

1. **Show the top few, then "N more".** Each list has a cap, ranked so what matters is in it: what needs the person, what changed last. The count of the rest is a button that shows them in place, or a link to the page that holds them all.
2. **Page in place.** Where a list really is long (a Browse cluster's items), load it when it's opened, 50 at a time, with **Show 50 more** and a count of what's shown.
3. **Search before scrolling.** Every long list has a way to narrow it first: Browse's search and filters, the sidebar's thread search, the connect step's project search.
4. **No infinite scroll, no virtual list.** Loading more is always the person's click, and the page always says how much there is. A cache or a virtual list comes later, and only if a measurement says it must (decision 0027).

| List                                                     | Cap                             | More                                                |
| -------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| Sidebar: Needs you                                       | 8                               | **N more**, in place                                |
| Sidebar: a workstream's threads                          | 5                               | **N more**, to the workstream's page                |
| Sidebar: Done                                            | 5                               | **N more**, to the Done page                        |
| Overview: workstreams                                    | 8, then up to 4 gone quiet      | **N more**, in place                                |
| Overview: not in a workstream yet, in progress by person | the server's top rows           | **N more**, to Browse, filtered or grouped          |
| Browse: a cluster's items                                | 50 a page, loaded when it opens | **Show 50 more**, with "50 of 214 shown"            |
| Done page                                                | 50 a page                       | **Previous**, "Page 1 of 3 · 128 threads", **Next** |
| A block's rows or table                                  | 20 rows (10 bars)               | "and 12 more", text only: ask a narrower question   |

```html specimen id=n-more title="N more: in place (a button), or to its page (a link)"
<div class="ws-stack">
  <button type="button" class="overview-more">6 more</button>
  <button type="button" class="nav-link nav-more">3 more</button>
  <a class="nav-link nav-more" href="/workstream/checkout-v2">2 more</a>
</div>
```

```html specimen id=show-more title="Show 50 more, loading, and failed"
<div class="ws-stack">
  <p class="more-items">
    <button type="button" class="button" aria-label="Show 50 more of Checkout v2's items">
      Show 50 more</button
    ><span class="more-count">50 of 214 shown</span>
  </p>
  <p class="more-items" data-state="loading">Loading…</p>
  <p class="more-items" data-state="failed" role="alert">
    <span>These items didn't load.</span><button type="button" class="button">Try again</button>
  </p>
</div>
```

```html specimen id=pager title="The Done page's pager"
<nav class="pager" aria-label="Pages of done threads">
  <a class="quiet-action" href="/done?page=1">Previous</a
  ><span class="pager-where">Page 2 of 3 · 128 threads</span
  ><a class="quiet-action" href="/done?page=3">Next</a>
</nav>
```

### Search first

Browse's search asks the server once typing pauses for 150 ms (Enter doesn't wait), and its count line says what it found: "12 matches in 3 clusters" (`Counts` in `packages/web/src/window-page.tsx`). Nothing found: "Nothing in the window matches these filters." with **Clear filters**. The sidebar's thread search answers "2 results", "No thread matches that.", or "Oriel couldn't search just now. Keep typing to try again." See [Text field › Search](/components/text-field#search).

## Do

- Cap every list, and rank what's in the cap so the person rarely needs the rest.
- Say how many more there are, as a number: "6 more", "Show 50 more", "50 of 214 shown".
- Show the rest in place when the list belongs to this page; link to its page when another page owns it.
- Give "Show 50 more" an `aria-label` that names the list: "Show 50 more of Checkout v2's items".
- Offer search or filters on any list that can grow past a page.
- Run `pnpm perf` (the window opening on a 4,000-item world, against its budget) after touching the index, the overview or Browse.

## Don't

- Don't load more on scroll. More is a click.
- Don't add a virtual list or a cache to make a long list fast. Make it shorter first.
- Don't hide the total. A list that says "6 more" can be trusted; one that just ends can't.
- Don't page a list that a cap and "N more" would serve.

## Where Oriel does it

- Sidebar caps: `shown` in `packages/web/src/sidebar.tsx`; Needs you's "N more", `NeedsYou` in `packages/web/src/sidebar.tsx`; a workstream's, `WorkstreamEntry` in `packages/web/src/sidebar.tsx`. CSS `.nav-more` and `button.nav-more` in `window.css`.
- Overview caps: `shown` in `packages/web/src/overview.ts`; "N more", `More` in `packages/web/src/overview-page.tsx`. CSS `.overview-more` in `window.css`.
- Browse's paging: `More` in `packages/web/src/window-page.tsx`, 50 a page (`pageSize` in `packages/web/src/view.ts`). CSS `.more-items` in `window.css`.
- Browse's counts: `Counts` in `packages/web/src/window-page.tsx`. The pause before a search: `pauseMs` in `packages/web/src/search.ts`.
- The sidebar's thread search: `ThreadSearch` in `packages/web/src/sidebar.tsx`.
- The Done page's pager: `DonePage` in `packages/web/src/other-pages.tsx`, 50 a page (`perPage` in `packages/web/src/nav.ts`). CSS `.pager` in `window.css`.

### Drift

"More" has four shapes: an in-place `<button>` (overview, Needs you), a link styled the same (the overview's candidates and people, a workstream's threads, Done), Browse's bordered **Show 50 more** with its count, and the Done page's pager. The words are "N more" everywhere except Browse ("Show N more") and the pager. Until they're one, copy "N more" for a capped list and Browse's **Show 50 more** for a paged one.
