# 0030 The window chat opens from an ask bar; answers carry blocks, and a block can be pinned

Accepted 2026-11-02 (OA-136, OA-137). Amends 0024 and 0027. Changes SPEC §1, §2, §4, §7 and §10, and AGENTS.md's checklist.

Adds: none

**Decision.**

- **An ask bar, not a rail.** "Ask about your window" is an input under the overview's counts strip. The overview keeps its full width while nobody is asking.
  - Asking opens the window chat beside the overview, over the page's right side; on a narrow window it opens as a sheet. Closing it gives the overview its full width back and doesn't end the chat: the next question from the bar goes to the same working window chat. New chat is in the open chat's header.
  - Everything else 0027 says about the window chat stands: it is short-lived, on its own workstream, made by its first question or cite, starts afresh after Continue in… or New chat, and the item panel covers it while an item is open.
- **Questions to start from.** Under the bar, a few questions computed from the overview's data, never generated: the workstream that moved most since the user last looked, the one stalled longest, the top candidate in Not in a workstream yet. With a row cited, the bar offers questions about that row instead: "What's happening in it?" for a workstream, "Make a workstream of it" for a candidate.
  - A question to start from is fixed wording and its row's ID. The row reaches the agent by ID in a tool result, as a cited row does (0027), never by its name or title, which may be synced text; the name shows only on the button. Unlike a cite, it adds nothing to the window chat's workstream, so "Make a workstream of it" doesn't put the candidate in the chat's workstream first. How that question avoids a second copy of a candidate the user already cited is OA-137's.
- **Blocks.** An answer can carry blocks: bars, a table, or rows of items. The agent's prose stays its own; a block is Oriel's.
  - The agent asks for a block by naming a read it ran in this turn and a form, and which of the read's fields to show. It never writes a number, a title or a row. Oriel builds the block from that read's result, and may filter, count or sum by a field, so every figure and row in a block comes from a tool result through Oriel's code. The exact shape of the request is OA-136's.
  - The read is named by a handle the host gave it in this turn, and the block is built from the host's own copy of that read's answer, never from a value the agent's code passes in. Its labels come from the read's declared fields, not from strings the agent sends. Today a read declares its result only as a type; each read a block can use gains a declaration of its result's fields, with their labels, as a source declares its facets (0027). A read without one can't make a block.
  - Oriel validates the request. One whose read failed, whose result doesn't have the shape the form needs, or that names a field the read doesn't declare, is refused, and the agent is told why in a tool result. Nothing is shown in its place. The host caps the blocks the agent asks for in one answer. The escape hatch's blocks don't count toward it and are never dropped: every reach outside the region shows.
  - A block is typed data, never HTML, as the panel's rich text is (0025). Synced text in it renders as text.
  - Each block carries a caption, written by Oriel, of where it came from: "Computed by Oriel from the change log: members changed since Tue, Oct 27".
  - Bars: one series, ranked, horizontal, each value labelled, at most 10 and then "and N more". Never two axes. Table: at most 5 columns, numbers right-aligned. Rows: items as Browse shows them, each of which opens in the panel or can be cited.
  - **Blocks are a thread feature,** not the window chat's alone. Any thread's agent can ask for one from a read it ran in that turn, and the thread page shows it. There is one way of building a block and one renderer. The escape hatch's block (SPEC §1.6) is the rows form, which Oriel shows for `search()` without being asked; it moves onto the same renderer. A block built from a read outside the region is still the escape hatch, under the same rules, and the renderer marks it as from outside the workstream and read-only, as today.
  - A block is stored with its turn as Oriel built it, so the thread shows the same block when reopened.
- **Pins.** A block can be pinned to the overview. A pin is a saved read, not saved text: the read, its arguments (IDs, never names) and the block's request (its form, its fields, and any filter, count or sum), so a rerun builds the same block from fresh data.
  - Only a block built from one of Oriel's index reads that need no region can be pinned: `window.overview()`, `search()`, and Oriel's reads of its own data. Any other block, such as one from `jira.listStories()` in a workstream's thread, or in a window chat with a cited epic, offers no Pin, and pinning it is refused.
  - The overview reruns a pin on each look with the same read declarations a thread uses, run by a host that has no source client, with its stored arguments checked again. There is no second read path. It makes no model call and no call to a source, so 0027's "nothing on the overview needs a model" holds.
  - Pins show in their own Pinned strip under the counts, keeping their form, top 3 (bars, or a table's or rows' first 3 rows), labelled "rerun each time you look", each with Unpin.
  - At most 4 pins. Pinning a fifth asks the user which to replace. `pin.add` takes the pin it replaces, so a replace is one action with one Undo, which puts the old pin back. Without one, a fifth is refused, naming the four, for the agent and outside tools too. An Undo that would make a fifth is refused the same way.
  - A pin whose arguments name something deleted (a workstream, 0028, or a thread) says so and offers Unpin.
  - `pin.add` and `pin.remove` are direct actions (0024), each with Undo, open to the user, the agent and outside tools. The user can ask the agent to pin an answer, as they can ask it to make a workstream.
- **In progress, by person, shows the top 10,** by items in progress, then "N more", which opens Browse grouped by assignee and filtered to in progress. Asking the window ("what is Nia working on?") covers the rest. Ten is more than 0027's "a few rows", for this section only.

**Why.**

- The window-explore spike scored 0027's design and its alternatives on a large world (4,000 items, 10 sources, 40 workstreams) at 1280 and 600 pixels wide, in rounds 10 to 14.
- A standing rail costs the overview its width. With the rail (round 10), the overview dropped to one column on a laptop, people fell below the workstreams, and one reading answer was lost. The ask bar (round 11) got the full width back. An empty rail is a quarter of the screen spent on nothing.
- Blocks read well: judges read a figure off a chart or table at 95–97% confidence, every time, at both widths.
- A pin must keep its form. Rounds 10 and 11 pinned an answer as a line of text, and both reviewers flagged it: cropped, and indistinguishable from the overview's own facts. A strip that keeps the chart (rounds 12 to 14) fixed it.
- Questions to start from took asking from 11 steps to 8 per width, and questions about a cited row to 7. Round 14 was the first and best to score 20 of 20.
- SPEC §1's central risk is a coarse view the user can't trust. A model writing a chart's figures would be exactly that. A block built by Oriel from a tool result, with its source in its caption, isn't, and naming a read can't invent a figure the way writing one can.
- A question to start from that put a title in the user's message would deliver synced text as the user's words, which SPEC §5 forbids. A cite by ID keeps it in a tool result.
- Pins rerun on every look, outside any run, so they must not reach a source or a region: a page view would make source calls with arguments an agent chose, against a region that may have changed.
- Pinning changes Oriel's own data, not a source, and isn't approval, erasing or credentials, so under 0024 it is a direct action the agent may take. A pin is still built and labelled by Oriel, capped at 4, and undone in one step.
- A workstream's thread asks the same questions of its own items ("which stories have no estimate", "estimates by assignee"). Two ways of building tables would drift apart; one builder and one renderer keep the guarantee in one place.
- The roster showed all 60 people on the large world, and every round's reviewer flagged it. The long-lists rule designs a long list away before scrolling it: the top 10 answer "who is busiest", and the chat answers about anyone else.

**Rejected.**

- **Keeping 0027's rail.** It scored 19 of 20 against the ask bar's 19.5, and the reviewer slightly preferred its always-visible input. It lost on width.
- **Answers in place on the overview** (round 12). The same score as the ask bar, but an open answer pushes Needs you below the fold.
- **The agent writing a block's data.** A model's numbers in a chart are the untrustworthy coarse view SPEC §1 warns about, and a model's HTML would be a way in for synced text.
- **Pinning the agent's text.** It goes stale, and rerunning it would need a model on every look.
- **Blocks only in the window chat.** A second way of building tables in workstream threads would follow, without the guarantee.
- **Pins of any read.** A read bound to a region, or one that calls a source, can't be rerun on the overview, which has neither.
- **Pinning as the user's action only, as the spike proposed.** 0024 gives the agent every direct action, and the user can already tell it to make or delete a workstream. Nothing makes a pin riskier than those.
- **Rearranging the overview by asking** ("hide people", "group by source"). Pins are the bounded version: the user adds to the overview, and nothing reorders it.
- **No cap on the roster.** Capping it cost the spike one judged answer, about someone outside the top rows. Asking the window now answers that, and 60 rows don't belong on the first view.

**Consequences.**

- Amended here, not edited: 0027's window chat lives behind an ask bar, not in a right rail, and its "rail" means the open chat beside the overview. 0024's registry gains `pin.add` and `pin.remove`.
- OA-136 (the window chat) takes the ask bar, blocks and questions to start from. OA-137 (Cite) takes questions about a cited row. Pins are a new story after OA-136, with a migration for them and their two actions.
- The agent's module gains a way to ask for a block, so its size base rises, and every eval cassette is recorded again.
- "Block" is now the glossary's word for what Oriel builds from a read. The web transcript's `Block` union, which covers every chat entry including the agent's reply, is renamed to entries by OA-136. The panel's `PanelBlock` and the rich-text blocks 0025 shares with replies are rich text, and their code names say so when next touched.
- "Pin" now names an overview feature. A thread is on a workstream, not pinned to it; SPEC §1.1 says so, and 0027's "pinned to a workstream" reads that way.
- Reads gain declared result fields, Oriel's own first, with OA-136. A source's catalogue reads (0019) gain theirs when a block first needs them, and the add-source skill asks a new source for them.
- `HeldSender` and Continue in… are unchanged. A block in a quoted exchange reaches the next thread as part of the tool result, never as the user's words.
- New telemetry: a block shown (by form) or refused, a pin made or removed, and a question to start from used.
- Guards are unit tests, not evals: a block's figures match its read's result, a refused block shows nothing, and rerunning a pin calls no model. An eval is added only if the agent's prose is seen contradicting its own block.
