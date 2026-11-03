# 0035 The index reads its records once per sync

Accepted 2026-11-02 (OA-189). Amends 0027.

Adds: none

**Decision.**

- The index store reads its live records, and its change log, from the database once after each write to the index, and every reader shares that one read until the next write. A sync is the only writer, so nothing a reader gets is ever behind the database.
- What it shares is frozen, and each reader gets its own list, which it may sort or filter.
- Nothing else is kept between requests: the overview, Browse's clusters and the item panel are still computed when they are asked for.
- `pnpm perf` times the window's open on a 4,000-item world in Chrome, against a budget: the overview shown within 150 ms warm and 400 ms cold, and its reply within 50 ms. It reads the clock, so it is a script, not part of `pnpm check`. Unit tests check that the reads are shared and frozen.

**Why.**

- A customer with about 4,000 issues said the window takes forever to open. On 4,000 issues with 3,000 change log entries and 12 workstreams, every overview, Browse and Jira view request read and checked every row again: 23 ms of the overview's 56 ms, and 18 ms more for the change log. `/api/jira` read every record to count them.
- Read once per sync, the overview's reply takes 20 ms, Browse's 3 to 7 ms instead of about 30, and the Jira view's 0. A warm open shows the overview in 64 ms instead of 102, and a cold one in 127 ms instead of 176 (medians of three runs each on a loaded machine).
- 0027 left a cache for a later decision, taken only if a measurement still needs it, and rejected one per snapshot version for the overview, which also depends on workstreams and the date. This one keeps only what a sync wrote, so the key can't go stale.

**Rejected.**

- **Caching the overview, or a grouping's clusters.** They depend on workstreams, threads and the date as well as the index, so they would go stale between syncs. What is left after this decision is about 17 ms.
- **Preloading every module from the page.** Measured, it didn't move the time to first draw: on the user's own machine, a level of imports costs almost nothing.
- **A count query for `/api/jira`.** Once the records are shared, counting them is free.
