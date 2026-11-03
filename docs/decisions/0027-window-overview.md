# 0027 The window opens on an overview

Accepted 2026-11-01. Changes SPEC §1, §2, §3, §4, §7, §8, §10, §12 and §13, and AGENTS.md's checklist. Amends 0018, 0024 and 0025. Amended by 0029: there is no canvas, so phase 2 is not the overview's cards placed by the user; Browse's zoom levels are a cluster row that opens to its items and an item that opens in the panel; and a model-written line on a workstream card falls under the summary-faithfulness eval. Amended by 0030: the window chat opens from an ask bar under the counts strip, not a standing right rail; answers carry blocks Oriel builds from a read's result, in any thread; a window chat's block can be pinned to the overview as a saved read; and in progress, by person, shows the top 10.

Adds: none

**Decision.**

- **The window has two views: the overview, where it opens, and Browse.** Browse is today's grouped list, with its groupings, its two zoom levels and Make workstream. The overview shows:
  - a strip of counts that opens what changed since the user last looked, by workstream;
  - what needs the user: threads waiting on them, and review links nobody has opened;
  - a card for each workstream: its members by source, its status bar, what moved since the user last looked, its activity over 14 days, its threads' states, and any signals;
  - Not in a workstream yet: every source's candidates, ranked together, with suggested workstreams and Make a workstream;
  - in progress, by person.

  No section lists more than a few rows. "N more" opens Browse, filtered to that slice, at its own address.

- **Workstreams come first.** The overview is about what the user curates. A source's own structure (an epic, a channel, a folder) shows there only as candidates for what to curate next. Its full view is Browse, filtered to that source.
- **Each source declares signals, not a section.** Its `overview` field on `SourceDeclaration`, declared as it declares its `panel` (0025), is a pure function of its index records, the change log, which items are in a workstream, and `now`. It returns candidates: an item or a cluster, with its rule and a weight on a scale every source shares. Examples: "an epic no workstream holds", "a question with no reply", "in progress, no update in 14 days". It returns data, never HTML. Leaving it out is a type error.
- **One ranked section.** The overview ranks every source's candidates, and the Linked clusters below, together by weight in one capped section, "Not in a workstream yet". Suggested workstreams live there. Each row shows its rule and its source.
- **Nothing on the overview needs a model.** Every number, list and signal is computed from the index, the change log, workstreams, threads and change sets. A signal Oriel derives ("in progress, no update in 14 days", "a question with no reply", "more than twice the median in progress") carries its rule, as a derived cluster does today. A model-written line on a workstream card may come later. If it does, it is generated after a sync, cites its items, and falls under the zoom-faithfulness eval (SPEC §8).
- **The index keeps a change log.** Each sync records, per item it changed, the facets that changed, before and after, and when an item was tombstoned.
  - Every source fills the common facets: state (its status category), people and container.
  - Each source declares its other facets, with their labels, as it declares its `panel`: Jira its estimate, a code host's source its review state and checks, a support desk's its priority. The change log and the overview show a declared facet by its label, and core never names one.
  - It records facets, never content, and keeps 90 days. "Since you last looked" uses a last-seen stamp per workspace, which moves when the user leaves the overview, not when they open it.
- **Items gain a `references` facet.** A reference is an item's naming of another item in its text. ("Mention" stays the word for naming a person.)
  - Each source declares a recognizer: a pure function from any text to that source's item IDs. Jira's finds its keys and issue links, in the projects it syncs, so `UTF-8` is not a key; Slack's finds its message links. No adapter knows another source's format, so a new source can be referenced from Slack and the folder with no change to their adapters.
  - At sync, an adapter hands each record's text to the core alongside the record, never into it. The core runs every source's recognizer over that text, resolves what they found against the index, stores it by stable ID, and drops the text. A Slack message naming SYN-54 references `jira:SYN-54`.
  - A reference to an item the index doesn't have yet is kept unresolved, by source and handle, and is resolved when a sync brings that item in. An unresolved one is dropped after 90 days, as the change log is.
  - A new grouping, "Linked" (an item, and the items that reference it or that it references), uses it. Its most active clusters among items no workstream holds are candidates in "Not in a workstream yet". A reference is never a hierarchy: no epic is invented from it.
- **The window chat.** The overview's right rail holds a thread: "Ask about your window".
  - Like every thread, it is pinned to a workstream. Its thread and its empty workstream are made with its first question or its first cite, and the workstream shows in the sidebar from then on. An untouched rail makes nothing.
  - It is short-lived. After Continue in…, or New chat in the rail, the rail starts a fresh window chat with no history. The old one is marked done, as the user's action with its own `via`, unless something in it still waits on the user (a change set or a held message). Then it stays working and in Needs you, out of the rail. The old one stays reachable from the Done page and through the held message's link back. A window chat the user leaves alone settles through the usual drop after 7 days idle. A reopened one is an ordinary thread on its workstream. The rail shows only a working window chat; once the newest is done or dropped, the rail is empty, ready for a fresh first question.
  - A window chat's workstream with no members and no working thread is hidden everywhere workstreams are listed: the sidebar, the overview, Continue in…, Cite's targets, the pickers and Oriel's reads. It isn't deleted, because 0024 deletes only a workstream no thread has used, and the old chat still opens it. It shows again once it has a member or a working thread. One that gained members through Cite is a real workstream and stays.
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
- Sources will be many and different. Each knows best what matters in its items, as each already knows its view of one item (0025). With ten sources, a section each would make a long page again, and no section would see across sources. A source adds candidates to one ranking instead.
- A fixed set of change-log facets (state, people, container, estimate) is Jira's shape. Common facets plus declared ones keep Jira's shape out of core (SPEC §3).
- A model on every open would cost money and time, and would let synced content steer what the user sees. Computed signals with their rules shown keep the coarse view trustworthy, which SPEC §1 names as the central risk.
- The index already knew which items changed in a sync, but not how. Facets before and after are the minimum that "moved to Done" needs.
- Slack messages and files name Jira items all the time. Following those names links sources without a model. Each source recognizing only its own IDs keeps one source's format out of another's adapter (SPEC §3), so references grow with N sources, not N×N.
- Questions about the window, and advice from it, belong where the user is looking. Citing builds a workstream in place. A short-lived window chat keeps its context small: once the conversation moves into a workstream, or the user starts over, the next question starts clean. A held message carries the conversation on, and delivering its quote as a tool result keeps one agent's words, and any synced text they repeat, from reaching another thread as the user's.
- A customer with about 4,000 issues says the window takes forever to open. Today every load sends every item of every cluster.

**Rejected.**

- **A briefing alone** (what changed, and nothing else). Quiet workstreams disappear from it, and a stalled one is the risk.
- **A timeline as the overview.** It shows when things changed best. But while one person's syncs are the only thing feeding it, it mostly shows when that person synced. It waits for watchers.
- **A model summary on every open.** It costs too much, it's slow, and it gives synced content a lever (SPEC §5).
- **A section per source on the overview.** Ten sources stack into a long page, and none of them ranks against the others.
- **A fixed set of change-log facets.** It is Jira's shape, and a code host's review state or a support desk's priority has no place in it.
- **One long-lived window chat.** Its context grows without bound. New chat covers the user who asks every day and never continues anywhere.
- **Hiding the window chat's workstream until it has members.** The maintainer preferred the sidebar to show it at once. It shows as soon as the chat is made.
- **Deleting an empty window chat's workstream.** Its old chat still opens it, and 0024 deletes only a workstream no thread has used.
- **Copying the window chat into a new thread when the user continues elsewhere.** Its agent's words would reach another thread with no person in between.
- **A virtualized list now.** It is a dependency, and paging, filtering and search make most long lists unnecessary.
- **A cache per snapshot version now.** The overview also depends on workstreams and the date, so that key goes stale, and paging may make a cache unnecessary.
- **Each adapter resolving references itself.** An adapter can't see the index, and every adapter would have to learn every other source's key and link format.

**Consequences.**

- `/` is the overview, and Browse has its own address, which keeps the grouping in it. The sidebar's Window link opens the overview.
- A migration adds the change log, and the index store writes it in the same transaction as the sync. `SourceDeclaration` gains its declared facets, with labels. A second migration, or the same one, adds the last-seen stamp.
- `SourceDeclaration` gains a recognizer for its own references, and a sync page carries each record's text to Oriel's sync, which runs the recognizers and never stores the text. The sync worker moves out of `packages/jira`, where it began as the first source's, into core, so recognizers never run inside an adapter's package. The injection evals (SPEC §8) gain a message whose reference is itself an injection.
- `SourceDeclaration` gains `overview`, which returns candidates. A new source adds one, as it adds a `panel`. Browse gains a source filter.
- Amended here, not edited: 0018's ways for membership to change gain Cite; 0024's senders of held messages gain other threads, a sent held message's quote reaches the agent as a tool result, an agent may read items outside its region through `window.overview()` as well as `search()`, and may add its run's `window.overview()` rows.
- `thread.done` gains a `via` for Continue in… and for New chat, and `thread.marked-done` carries it.
- `HeldSender` gains a kind for a thread on another workstream, the window chat being the first. OA-89, another thread's agent, uses the same kind.
- New telemetry: the overview opened, a "more" opened (by section), a suggestion made a workstream, an item or workstream cited, and Continue in used. The window chat's own questions count as `question.asked`.
- Phase 2's canvas becomes the overview's cards, placed by the user, with the links between them drawn. SPEC §13's kill criterion can now be asked of the overview.
- The timeline (a Timeline view beside Browse) waits on watchers: a way for other people's and other systems' changes to come in without this person's Oriel acting. That needs its own decision, since SPEC §14 rules out real-time sync for now.
- Polish to the epic list as the home page is superseded. Polish to the list itself carries over to Browse.
