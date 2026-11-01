# 0025 Read an item in a panel beside the page

Accepted 2026-11-01 (OA-61). Changes SPEC §1, whose right rail opened each item in its source.

Adds: none

**Decision.**

- A plain click on a link to an item opens it in a panel beside the page: from a window row, a group's member, the thread's rail, a change set's diff, a search result, a marker, or an agent's reply. Cmd/Ctrl, Shift or a middle click goes to the item in its source, as before; so does the panel's "Open in Jira" or "Open in Slack" button. A file has no web page of its own, so its links open only the panel.
- Each source declares its own view of an item, as one more field on its `SourceDeclaration` (`panel`). The server turns a live read into typed blocks (facts, text, messages, notes); the web renders them as elements. A source may also name the panel where the item's title would only repeat it: a Slack message's title is its first line, so its panel is named by its channel. Source text is never parsed as HTML. A file's markdown goes into the same blocks an agent's reply uses. Jira's and Slack's text show as written, line by line.
- The panel reads its item when it opens, through the reader the agent's `items.read` uses, so both see the same item. It says when it read the item. Whenever the window or the lists load again, it asks the index when the item last changed, and says "Jira has changed since" once the index has seen a change later than both the read and what the index knew at the read.
- Which item is open is part of the address (`?item=jira:SYN-12`) on every page but a review link's, which has no panel. Opening one adds to history, so Back closes it. Escape closes it too.
- Opening and closing the panel is view state, not one of Oriel's actions (0024): it changes none of Oriel's data, and its routes are reads.
- Telemetry: `item.panel-opened` and `item.source-opened` (via the panel or a link), each by source kind.

**Why.**

- Reading something shouldn't take the user out of Oriel. Each trip to a new tab is a context switch away from the group they're working on.
- The agent and the user should be looking at the same item. A second read path could disagree with what the agent was told.
- Anyone who can edit a source can write what the panel shows, so it renders typed blocks, never HTML.

**Rejected.**

- An HTML preview of the source page (an iframe or fetched markup). It is untrusted markup, and most sources refuse to be framed.
- Showing only what the index keeps. The index holds the minimum for grouping (SPEC §7), so descriptions, comments and replies need a live read anyway.
- One generic view for every source. A Slack conversation's messages and a Jira issue's fields read differently; each source knows its own.

**Consequences.**

- Each new source adds a `panel` to its declaration; leaving it out is a type error.
- Opening a panel costs one live read from the source. A Jira read also fetches every comment and remote link.
- "Changed since" learns of changes only through the index, so it waits for a sync or a change set to land.
