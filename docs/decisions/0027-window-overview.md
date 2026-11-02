# 0027 The window opens on an overview

Accepted 2026-11-01. Changes SPEC §1, §2, §3, §4, §7, §8, §10, §12 and §13, and AGENTS.md's checklist. Amends 0018, 0024 and 0025.

Adds: none

**Decision.**

- **The window has two views: the overview, where it opens, and Browse.** Browse is today's grouped list, with its groupings, its two zoom levels and Make workstream. The overview shows:
  - a strip of counts that opens what changed since the user last looked, by workstream;
  - what needs the user: threads waiting on them, and review links nobody has opened;
  - a card for each workstream: its members by source, its status bar, what moved since the user last looked, its activity over 14 days, its threads' states, and any signals;
  - for each source, its own view of what no workstream holds yet, with Make a workstream;
  - in progress, by person.

  No section lists more than a few rows. "N more" opens Browse, filtered to that slice, at its own address.

- **Workstreams come first.** The overview is about what the user curates. A source's own structure (an epic, a channel, a folder) appears in that source's view, as what no workstream holds yet.
- **Each source declares its own overview view,** as it declares its `panel` (0025): one more field on its `SourceDeclaration`, a pure function of its index records, the change log, which items are in a workstream, and `now`. It returns typed blocks (counts, ranked rows, status bars), never HTML. Leaving it out is a type error.
- **Nothing on the overview needs a model.** Every number, list and signal is computed from the index, the change log, workstreams, threads and change sets. A signal Oriel derives ("in progress, no update in 14 days", "a question with no reply", "more than twice the median in progress") carries its rule, as a derived cluster does today. A model-written line on a workstream card may come later. If it does, it is generated after a sync, cites its items, and falls under the zoom-faithfulness eval (SPEC §8).
- **The index keeps a change log.** Each sync records, per item it changed, the facets that changed (state, people, container, estimate), before and after, and when an item was tombstoned. It records facets, never content, and keeps 90 days. "Since you last looked" uses a last-seen stamp per workspace, which moves when the user leaves the overview, not when they open it.
- **Items gain a `references` facet.** A reference is an item's naming of another item in its text. ("Mention" stays the word for naming a person.)
  - Each source declares how to recognize its own items in any text: Jira its keys and issue links, in the projects it syncs, so `UTF-8` is not a key; Slack its message links. No adapter knows another source's shapes.
  - At sync, an adapter hands each record's text to the sync worker alongside the record, never into it. The worker runs every source's recognizer over that text, stores what it found by stable ID, and drops the text. A Slack message naming SYN-54 references `jira:SYN-54`.
  - A reference to an item the index doesn't have yet is kept unresolved, by source and handle, and is resolved when a sync brings that item in. An unresolved one is dropped after 90 days, as the change log is.
  - A new grouping, "Linked" (an item, and the items that reference it or that it references), uses it. The overview suggests the most active of these clusters among items no workstream holds. A reference is never a hierarchy: no epic is invented from it.
- **The window chat.** The overview's right rail holds a thread: "Ask about your window".
  - Like every thread, it is pinned to a workstream. Its workstream starts empty and shows in the sidebar from the start.
  - There is one window chat per workspace. It is never dropped for being idle and is never marked done. Work moves out of it through Continue in…, so no empty workstreams pile up behind it. Starting it afresh is a later decision.
  - Its agent gets one more Oriel read, `window.overview()`, which returns the overview's data as a tool result, plus `search()`. An item row from `window.overview()` is outside the region, so it counts as a `search()` hit for every rule that has: it shows as the escape-hatch block, it counts as "escape hatch used" (SPEC §7) and for scope discipline (SPEC §8), and the agent may add it to a workstream (0024). Oriel's actions (0024) work there as in any thread: a workstream the agent makes shows in the sidebar at once, with Undo.
  - **Cite.** Any overview row, Browse row or workstream card can be cited into the open chat, the window chat or a thread's page. A cited item joins the thread's workstream as a dropped key does (0018), as the user's action, with Undo and a marker. A cited workstream or item reaches the agent as its ID, never its name or title, which the agent reads through Oriel's reads as a tool result. A workstream named after an epic takes the epic's title, which anyone can edit.
  - **Continue in….** The user can carry the conversation to a workstream: the window chat's own, one the agent made, or any other. This opens a thread on that workstream whose first entry is a held message from the window chat (0024). The message quotes the exchange the user picked, links back, and makes no model call. The user sends it, edited or not, or discards it. When it is sent, the quoted exchange reaches the agent as a tool result marked as from the window chat. Only what the user writes is the user's message. This amends 0024, where a sent held message is wholly the user's words.
  - The item panel (0025) covers the rail while an item is open.
- **Long lists are avoided before they are scrolled.**
  - Browse loads cluster rows first, and a cluster's items when the user opens it, 50 at a time, with a filter.
  - Browse gets item search over the index and the filters SPEC §4 promised.
  - A cache and a virtualized list are later decisions, each taken only if a measurement still needs it. SPEC §14 keeps caching layers out for now.

**Why.**

- Today's window is the source's structure as a table. It doesn't show what changed, what moved, what Slack is talking about, the workstreams' own state, or what Oriel did. A PM opens it for those, and for what to make a workstream of next.
- Workstreams are what the user curates, and the source's structure is already in the source. The overview should show the user's own work first, and what isn't covered yet as an invitation to curate.
- Sources will be many and different. Each knows best what matters in its items, as each already knows its view of one item (0025).
- A model on every open would cost money and time, and would let synced content steer what the user sees. Computed signals with their rules shown keep the coarse view trustworthy, which SPEC §1 names as the central risk.
- The index already knew which items changed in a sync, but not how. Facets before and after are the minimum that "moved to Done" needs.
- Slack messages and files name Jira items all the time. Following those names links sources without a model. Each source recognizing only its own shapes keeps one source's format out of another's adapter (SPEC §3).
- Questions about the window, and advice from it, belong where the user is looking. Citing builds a workstream in place. A held message carries the conversation on, and delivering its quote as a tool result keeps one agent's words, and any synced text they repeat, from reaching another thread as the user's.
- A customer with about 4,000 issues says the window takes forever to open. Today every load sends every item of every cluster.

**Rejected.**

- **A briefing alone** (what changed, and nothing else). Quiet workstreams disappear from it, and a stalled one is the risk.
- **A timeline as the overview.** It shows when things changed best. But while one person's syncs are the only thing feeding it, it mostly shows when that person synced. It waits for watchers.
- **A model summary on every open.** It costs too much, it's slow, and it gives synced content a lever (SPEC §5).
- **Hiding the window chat's workstream until it has members.** The maintainer preferred the sidebar to show it at once.
- **Copying the window chat into a new thread when the user continues elsewhere.** Its agent's words would reach another thread with no person in between.
- **A virtualized list now.** It is a dependency, and paging, filtering and search make most long lists unnecessary.
- **A cache per snapshot version now.** The overview also depends on workstreams and the date, so that key goes stale, and paging may make a cache unnecessary.
- **Each adapter resolving references itself.** An adapter can't see the index, and it would have to know every other source's key and link shapes.

**Consequences.**

- `/` is the overview, and Browse has its own address, which keeps the grouping in it. The sidebar's Window link opens the overview.
- A migration adds the change log, and the index store writes it in the same transaction as the sync. A second migration, or the same one, adds the last-seen stamp.
- `SourceDeclaration` gains a recognizer for its own references, and a sync page carries each record's text to the worker without storing it. The injection evals (SPEC §8) gain a message whose reference is itself an injection.
- `SourceDeclaration` gains `overview`. A new source adds one, as it adds a `panel`.
- Amended here, not edited: 0018's ways for membership to change gain Cite; 0024's senders of held messages gain other threads, a sent held message's quote reaches the agent as a tool result, an agent may read items outside its region through `window.overview()` as well as `search()`, and may add its run's `window.overview()` rows; SPEC §1.3's drop after 7 days spares the window chat.
- `HeldSender` gains a kind for a thread on another workstream, the window chat being the first. OA-89, another thread's agent, uses the same kind.
- New telemetry: the overview opened, a "more" opened (by section), a suggestion made a workstream, an item or workstream cited, and Continue in used. The window chat's own questions count as `question.asked`.
- Phase 2's canvas becomes the overview's cards, placed by the user, with the links between them drawn. SPEC §13's kill criterion can now be asked of the overview.
- The timeline (a Timeline view beside Browse) waits on watchers: a way for other people's and other systems' changes to come in without this person's Oriel acting. That needs its own decision, since SPEC §14 rules out real-time sync for now.
- Polish to the epic list as the home page is superseded. Polish to the list itself carries over to Browse.
