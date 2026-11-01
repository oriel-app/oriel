# 0023 The inbox becomes the Done page

Accepted 2026-11-01 (OA-53). Amended 2026-11-01 (OA-55): dropped threads have their own tab.

Adds: none

**Decision.**

- The sidebar has no Inbox item and Oriel has no inbox page. Each thread state shows somewhere:
  - a working thread under its group in the sidebar and on its group's page, and in Needs you while it waits on a review or a reply;
  - a done or handed-off thread on the Done page, at `/done`, and the latest few in the sidebar's Done section, an accordion above the sources;
  - a dropped thread on the Done page's Dropped tab, at `/done?tab=dropped`, which the opened Done section leads to.
- The Done page shows 50 threads a page in each tab, most recently active first, with Previous and Next, and each tab counts its threads. `/inbox` is gone: the server 404s it.
- The Done page pages in the browser, over the threads list the sidebar already loads.
- SPEC §1, §3, §4 and §10 and AGENTS.md's checklist say this in place of "the inbox".

**Why.**

- The sidebar needed room. The Inbox item took a line, and its page mostly held threads that were finished.
- What needs the user was already in Needs you, so the Inbox's badge only had to move: the folded sidebar's fold button counts the waiting threads now.
- The sidebar needs every thread for Needs you and the groups, so a server-paged endpoint would send the same threads twice.
- A handed-off thread needs nothing more from the user, so it sits with done ones. A dropped thread may be one to come back to; among finished work it was buried (OA-55).

**Rejected.**

- Keeping `/inbox` as an alias for `/done`. The maintainer preferred one address.
- Paging on the server. That only pays once the sidebar stops loading every thread, which nothing needs yet.

**Consequences.**

- A bookmarked `/inbox` gets a 404.
- With many threads, `/api/threads` grows with all of them. Paging on the server comes when that hurts, with the sidebar loading only what it shows.
- The sidebar's Done count leaves out dropped threads; its opened section says how many there are.
