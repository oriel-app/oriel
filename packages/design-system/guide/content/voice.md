---
title: Voice and words
order: 10
summary: How Oriel writes. Plain words, short sentences, sentence case, the glossary's words exactly, and what errors, empty states, busy labels and confirmations say.
---

# Voice and words

Oriel is used by product and engineering managers for hours at a time. Its words should be the ones they'd use with a colleague: plain, short and exact. It never sells, never jokes, and never apologises. It says what happened, and what to do next.

Every string quoted with a `file:line` is Oriel's own, exactly. Where the string is a template, its names and numbers are filled in from the SYN fixture. The "don't" examples are made up, to show what to avoid.

## Plain words, short sentences

- **Say what it is.** "The window didn't load." (`Body` in `packages/web/src/window-page.tsx`), not "Something went wrong".
- **One idea to a sentence.** Two short sentences beat one with a semicolon: "No items. Add some from the window." (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`).
- **Name the person "you", and Oriel "Oriel".** "Nothing changes there until you approve it." (`ReadOnly` in `packages/web/src/connections-page.tsx`). Oriel speaks of itself in the third person: "Oriel couldn't search just now." (`ThreadSearch` in `packages/web/src/sidebar.tsx`). Never "we" or "I".
- **Everyday words over system words.** "Sync", not "refresh the index". "Its source hasn't answered for a while" (`ChangeSet` in `packages/web/src/thread-page.tsx`), not "upstream timeout".
- **No filler.** Not "simply", "just" (as a softener), "please", "successfully", "easily" or "powerful".

## The glossary

Oriel's words are fixed in `SPEC.md` §2. Use them exactly, in the interface, in specimens and in code. A word that changes from page to page makes a person wonder if it's a different thing.

| Say                                   | Means                                                                               | Not                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **workstream**                        | What the person is working on: a set of items they curate from any source           | project, folder, board, collection                            |
| **item**                              | One record from a source, such as a Jira story, a Slack message or a doc            | ticket, issue, card, task (unless it's the source's own type) |
| **source**                            | Anything that provides items: a tracker, a conversation, a document, a folder       | integration, app, data source                                 |
| **connector**                         | What teaches Oriel one kind of source, such as Jira or Google Sheets. Declared once | integration, plugin                                           |
| **connection**                        | One account, site, workspace or folder a person connected through a connector       | connector (it's the instance), account                        |
| **thread**                            | A workstream with a chat and its change sets                                        | chat, conversation, session                                   |
| **change set**                        | The changes the agent wants to make, held until the person approves                 | PR, pull request, diff, patch, proposal                       |
| **the agent**                         | The model Oriel runs inside a thread                                                | the AI, the assistant, the bot, Claude                        |
| **window**                            | Everything from every connected source, in one place                                | dashboard, home, feed                                         |
| **overview**                          | The window's first view                                                             | dashboard, home                                               |
| **Browse**                            | The window's grouped list (a proper noun)                                           | explorer, search                                              |
| **window chat**                       | The short-lived thread the ask bar opens                                            | assistant, helper                                             |
| **block**                             | Bars, a table or rows of items in an answer, built by Oriel from a read             | widget, card, chart                                           |
| **chip**                              | An item, thread, change set or workstream drawn in a line by Oriel                  | tag, pill, mention                                            |
| **sketch**                            | HTML the agent draws under its answer, never checked against Oriel's data           | mockup, preview, embed                                        |
| **draft**                             | An action of the person's the agent wrote out, held until applied                   | suggestion                                                    |
| **pin**                               | A block saved to the overview, rerun on each look                                   | bookmark, save. A thread is never pinned                      |
| **cite**                              | Put an item or workstream into a chat                                               | mention, attach                                               |
| **done**, **handed off**, **dropped** | Where a thread ended up                                                             | closed, archived, resolved                                    |

And the actions, as the buttons say them:

- **Approve and apply** (`stepLabel` in `packages/web/src/thread.ts`): the one primary action on a change set. Not "Merge", "Accept" or "Submit".
- **Reject**, **Revert**, **Dismiss**, **Try again**.
- **Mark done** and **Reopen**, for a thread or a workstream. Not "Close", "Archive" or "Resolve".
- **Make a workstream**, **Add a connection**, **Share review link**, **Open as a thread**.

## Sentence case, everywhere

Capitalise the first word and proper nouns only: buttons, headings, menu items, tabs, labels, tooltips.

- Buttons: "Approve and apply", "Share review link", "Add a connection".
- Menus: "Mark done", "Delete…" (`ThreadMenu` in `packages/web/src/close-thread.tsx`).
- Headings: "In progress, by person", "Not in a workstream yet", "Needs you".
- Proper nouns keep theirs: Oriel, Browse, Jira, Slack, Google Sheets, Claude Code.
- A source's own words stay as the source writes them, such as Jira's statuses "In Progress" and "To Do". They're its data, not Oriel's copy.

## Numbers and plurals

- **Digits, always:** "3 items", "1 point", "7 days". Not "three items".
- **Plural by count, with no "(s)".** `plural` in `packages/web/src/parts.tsx` writes "1 item" and "2 items".
- **Points:** "1 point", "3 points", or "1 pt" and "3 pts" where a row is tight (`points` in `packages/web/src/parts.tsx`).
- **Zero says what it means:** "Nothing picked", then "3 picked" (`Selection` in `packages/web/src/window-page.tsx`). "No items", not "0 items".
- **"N more" for what's folded:** "Show 20 more" (`More` in `packages/web/src/window-page.tsx`).

## Time

A person picks how times read, in Settings › General (decision 0046): "Relative, such as 3 min ago" or "Date and time, such as Nov 3, 09:41" (`timeFormatNames` in `packages/web/src/settings-page.tsx`). Relative is the default (`relative` in `packages/web/src/time.ts`):

- "just now", under a minute;
- "3 min ago", "2 h ago";
- "yesterday", then "4 days ago";
- past a month, the date: "Nov 3".

Ahead, it's "in 2 h" and "tomorrow". Abbreviate "min" and "h" with no full stop. Never write a time ahead for something that's happened. A review link's page always uses the default.

## Busy: the verb, then "…"

A control that's working changes its label to the verb in -ing, with "…" (one character, U+2026, never three full stops), and goes disabled until it's done:

| At rest           | Busy           | Where                                                   |
| ----------------- | -------------- | ------------------------------------------------------- |
| Delete            | Deleting…      | `Confirm` in `packages/web/src/close-thread.tsx`        |
| Add               | Reading…       | `FolderStep` in `packages/web/src/connect-steps.tsx`    |
| Disconnect        | Disconnecting… | `Disconnect` in `packages/web/src/connections-page.tsx` |
| Make a workstream | Making…        | `CandidateRow` in `packages/web/src/overview-page.tsx`  |
| Check again       | Checking…      | `Providers` in `packages/web/src/settings-page.tsx`     |

A whole region says what it's doing in a status line: "Working…" while the agent answers, "Syncing…", "Loading…". Approve and apply keeps its label, and the change set says "Applying…".

"…" also ends a menu item or button that asks a question before it acts: "Delete…". And it ends a placeholder that invites more: "Ask about 17 items…".

## Errors: what happened, and what to do

An error says what happened, in the past tense and plain words, then what the person can do. It doesn't say "Error:", "Oops", "Sorry" or "Something went wrong", and it doesn't show a code.

- "The window didn't load." with **Try again** (`Body` in `packages/web/src/window-page.tsx`).
- "This thread didn't load." (`ThreadPage` in `packages/web/src/thread-page.tsx`).
- "Oriel couldn't search just now. Keep typing to try again." (`ThreadSearch` in `packages/web/src/sidebar.tsx`).
- "This item isn't in Jira any more." or "Oriel can't read this item in Jira now." (`PanelBody` in `packages/web/src/item-panel.tsx`).
- "Its source hasn't answered for a while. Try again or dismiss it once it answers or Oriel gives up waiting." (`ChangeSet` in `packages/web/src/thread-page.tsx`).
- "Live writes aren't configured here, so this can be reviewed and rejected, not approved." (`ChangeSet` in `packages/web/src/thread-page.tsx`).
- "Couldn't add “SYN-23”:" then why (`dropNotice` in `packages/web/src/drop.ts`).

When Oriel doesn't know whether something happened, it says so: "This may have been made; Oriel didn't hear back." (`Outcome` in `packages/web/src/other-pages.tsx`). Never claim success or failure you can't see.

The pattern: **what happened**, then **why** if it's known and useful, then **the way on** ("Try again", "Check again", "Keep typing"). Put the way on in a button when there is one. See [Empty, loading and error](/components/states).

## Empty states: why, and the way on

An empty state says what isn't here, and how it gets here. It doesn't celebrate or apologise.

- "No workstreams yet. Make one from what isn't in a workstream yet, or from Browse." (`Workstreams` in `packages/web/src/overview-page.tsx`)
- "No thread is done yet. One is once its change set is applied, or you mark it done." (`DonePage` in `packages/web/src/other-pages.tsx`)
- "Pick items in the window, or make a workstream from a cluster." (`Workstreams` in `packages/web/src/sidebar.tsx`)
- "No items. Add some from the window." (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`)
- "No thread matches that." (`ThreadSearch` in `packages/web/src/sidebar.tsx`)
- "Ask about what changed, what needs you, or what should become a workstream." (`WindowChat` in `packages/web/src/window-chat-view.tsx`)

## Confirmations: the one question a delete asks

Oriel asks first only when Undo can't bring something back. Most actions just happen, with an Undo (see [Destructive actions and undo](/patterns/destructive-actions)). When it does ask:

- **The title is the question, with the thing's name in curly quotes:** "Delete “Gift cards”?" (`Endings` in `packages/web/src/end-workstream.tsx`).
- **The body says what goes, and what stays:** "Its 3 threads go with it, out of the sidebar, Needs you, the Done page and search. Its items stay in their sources. You can undo this right after." (`deleteWarning` in `packages/web/src/ending.ts`)
- **What it can't undo, said plainly:** "It made 2 changes in Jira. After deleting the thread you can no longer revert them from Oriel." (`deletionWarning` in `packages/web/src/closing.ts`)
- **The buttons are Cancel and the verb:** Cancel, then **Delete**. Never "Yes" and "No", never "OK". Cancel has the focus.
- **Disconnect** leads with the question in bold and says what happens to each thing: "**Disconnect Folder?** Its 38 items leave the window. Workstreams keep them as items Oriel no longer has, and threads keep what was said. Nothing changes in the folder." (`Disconnect` in `packages/web/src/connections-page.tsx`)

The undo note after says what was done, in the past tense, naming the thing: "Deleted “Gift cards”, with its 3 threads." (`endedText` in `packages/web/src/ending.ts`), "Added SYN-23 to “Checkout v2”." (`addUndos` in `packages/web/src/panel-adds.ts`).

## Naming the AI

- **"The agent"** is the model working in a thread: "Sent to the agent." "Sketched by the agent · not checked against Oriel's data" (`SketchFigure` in `packages/web/src/block.tsx`). Not "the AI", "Claude", "the assistant" or "the bot".
- **Claude Code** is named only as the person's own command-line tool, the product they install and sign in to: "Oriel can't use claude.ai in your browser, so it works through Claude Code" (`YourAi` in `packages/web/src/setup-page.tsx`), "Updating Claude Code…". The same goes for Codex.
- **Model names** (Opus, Sonnet, Haiku) appear only where a person picks one, in Settings.

## Products that inspired Oriel

Never name them: not in the interface, a specimen, a comment, a commit or this guide. Oriel's own CLAUDE.md lists it among the ways to hurt yourself. Describe the idea in Oriel's words instead. A change set is "a review of what the agent wants to change", not "like a pull request in…".

A source's name is fine, because it's the person's own: Jira, Slack, Google Sheets.

## Do and don't

| Do                                                                                 | Don't                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------- |
| The window didn't load.                                                            | Error: failed to fetch window.              |
| Oriel couldn't search just now. Keep typing to try again.                          | Oops! Search is unavailable.                |
| Approve and apply                                                                  | Merge, Accept, Submit                       |
| Add SYN-23 to a workstream                                                         | Add ticket to project                       |
| Change set                                                                         | PR, diff                                    |
| Thread                                                                             | Chat, conversation                          |
| The agent                                                                          | The AI, Claude, our assistant               |
| Make a workstream                                                                  | Create New Workstream                       |
| Deleting…                                                                          | Deleting... (three full stops), Please wait |
| No thread is done yet. One is once its change set is applied, or you mark it done. | Nothing to see here!                        |
| 1 item, 3 items                                                                    | 1 item(s), three items                      |
| Delete “Gift cards”? with Cancel and Delete                                        | Are you sure? with Yes and No               |
