# 0026 Call groups workstreams

Accepted 2026-11-01 (OA-98). Amends the vocabulary of 0018 and 0024. Changes SPEC §2's glossary and the prose that uses it.

Adds: none

**Decision.**

- A group is now called a workstream: what the user is working on, as a set of items they curate from any source, to track its progress and keep its context in one place.
- Only the word changes, not the model. 0018's versioned membership, regions and threads, and 0024's actions, stand as written. Read "group" there as "workstream".
- Groupings keep their name. They are lenses for finding items (epic, assignee, stuck); a workstream is what the user makes from what they find.
- The database renames its tables, columns and indexes in place (migration 0012), and keeps every row. A thread's workstream that Oriel still calls "New group" becomes "New workstream".
- `/groups/:id` redirects to `/workstreams/:id`, and `/api/groups` answers as `/api/workstreams`, so old links and bookmarks keep working.
- Telemetry stored before then keeps its old event names. SPEC §7 maps them to the new ones.

**Why.**

- "Group" says how items are collected, not why. The user curates a workstream to track progress on something they're doing and to keep its context in one place, and the name should say so.
- "Group" and "grouping" read as the same thing, but a grouping is a lens and a group was what the user built. Two words for two ideas keep them apart.

**Rejected.**

- Keeping "group" in code and renaming it only in the window. SPEC's glossary is used exactly, in code and prose, so the two would drift.
- Rewriting stored telemetry to the new names. Stored events are a record, and the mapping in SPEC §7 is enough for a report.

**Consequences.**

- Decisions up to 0025 still say "group". They stay as written.
- Recorded test data, old migrations and their tests keep the old word.
- Changing the agent's prompt invalidated every eval cassette, so they were recorded again.
