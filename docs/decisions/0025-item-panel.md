# 0025 Read an item in a panel beside the page

Accepted 2026-11-01 (OA-61). Changes SPEC §1, whose right rail opened each item in its source. Amended by 0027: the panel opens from every overview and Browse row, and covers the window chat's rail while an item is open. Amended 2026-11-01 (OA-93, OA-94, OA-95): a source may also give rich text, which its server side reads into typed blocks (a Jira description written with structure), never HTML, with links only to http(s); a message may set apart the people and channels it names, and say that it was edited, shared files or was also sent to the channel. From an open panel, the user steps through the list it was opened from, and adds the item to the current workstream through Oriel's action `workstream.add` (0024), with its Undo; opening, closing and stepping stay view state. Amended by 0032: the rich text replies share gains the chip and the quote from an item, drawn in an agent's answer only; in synced text `[[…]]` is text. Amended 2026-11-09: at 1100px and up, the panel no longer covers the window chat. An item opened while the window chat is open takes the window's edge, and the chat moves into the page column beside it; from 1100 to 1279px the panel narrows, to 24rem at least, so the chat keeps 28rem. Below 1100px it covers the chat, and carries the conversation's composer: over the window chat or a thread's page, the panel's foot is a dock with the latest answer's first two lines, "Chat", and the composer, looking at the item (0062). Sending keeps the item open, and the dock shows the answer as it arrives. "Chat" gives the conversation the screen, and the item folds to a line above its composer, with Show and ×; opening another item or closing it unfolds it (2026-11-09, OA-335). An agent's answer is a list the panel steps through (the items it names as chips, in its order), and a chip for the open item is marked while it's open. Amended 2026-11-10 (OA-337): where the panel isn't beside a conversation, it offers Ask about this, which goes to the overview with the item still open and opens the window chat beside it, or under it in its dock below 1100px: the current one, or an empty one whose first question makes it. Its composer offers the item. On a thread's page, a new thread's, or over the window chat, the composer already offers it, so the panel doesn't. The window chat stays the overview's.

Adds: none

**Decision.**

- A plain click on a link to an item opens it in a panel beside the page: from a window row, a group's member, the thread's rail, a change set's diff, a search result, a marker, or an agent's reply. Cmd/Ctrl, Shift or a middle click goes to the item in its source, as before; so does the panel's "Open in Jira" or "Open in Slack" button. A file has no web page of its own, so its links open only the panel.
- Each source declares its own view of an item, as one more field on its `SourceDeclaration` (`panel`). The server turns a live read into typed blocks (facts, text, messages, notes); the web renders them as elements. A source may also name the panel where the item's title would only repeat it: a Slack message's title is its first line, so its panel is named by its channel. Source text is never parsed as HTML. A file's markdown goes into the same blocks an agent's reply uses. Jira's and Slack's text show as written, line by line.
- The panel reads its item when it opens, through the reader the agent's `items.read` uses, so both see the same item. It says when it read the item. Whenever the window or the lists load again, it asks the index when the item last changed, and says "Jira has changed since" once the index has seen a change later than both the read and what the index knew at the read.
- Which item is open is part of the address (`?item=jira:SYN-12`) on every page but a review link's, which has no panel. Opening one adds to history, so Back closes it. Escape closes it too.
- Opening and closing the panel is view state, not one of Oriel's actions (0024): it changes none of Oriel's data, and its routes are reads.
- Telemetry: `item.panel-opened`, `item.source-opened` (via the panel or a link) and `item.asked-about`, each by source kind.

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
